import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ProviderApiKeyGuard, type ProviderApiKeyContext } from '../api-keys/provider-api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Prisma } from '@prisma/client';

/**
 * Vendor-facing API. Authenticated with `Authorization: Bearer rngr_<key>`.
 *
 *   GET /api/v1/integrations/bookings        — list bookings for this provider
 *   GET /api/v1/integrations/bookings/:id    — fetch one booking
 *   GET /api/v1/integrations/me              — provider profile + tier
 *
 * @SkipTenant is set because the ProviderApiKeyGuard does the tenant
 * resolution itself (via the API key → provider → tenant chain) and enters
 * the AsyncLocalStorage with the resolved tenantId. The interceptor would
 * try to resolve tenant from headers and double up.
 *
 * @Public bypasses the global JwtAuthGuard — vendors use API keys, not JWT.
 */
@Controller('integrations')
@Public()
@SkipTenant()
@UseGuards(ProviderApiKeyGuard)
export class IntegrationsController {
  constructor(private readonly prisma: PrismaService) {}

  private ctx(req: Request): ProviderApiKeyContext {
    return (req as Request & { providerKey: ProviderApiKeyContext }).providerKey;
  }

  @Get('me')
  async me(@Req() req: Request) {
    const { providerId } = this.ctx(req);
    return this.prisma.provider.findFirst({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        verticalId: true,
        vertical: { select: { id: true, name: true, slug: true } },
        address: true,
        city: true,
        postalCode: true,
        phone: true,
        email: true,
        isActive: true,
        subscription: {
          select: { tier: true, status: true, currentPeriodEnd: true },
        },
      },
    });
  }

  @Get('bookings')
  async listBookings(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { providerId } = this.ctx(req);
    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);

    const where: Prisma.BookingWhereInput = { providerId, isDeleted: false };
    if (cursor) where.id = { lt: cursor };
    if (status) where.status = status;
    if (from || to) {
      where.slot = {};
      if (from) (where.slot as any).startsAt = { gte: new Date(from) };
      if (to) {
        (where.slot as any).startsAt = {
          ...(where.slot as any).startsAt,
          lte: new Date(to),
        };
      }
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      take: take + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        slot: { select: { startsAt: true, endsAt: true } },
        customer: { select: { id: true, name: true, phone: true } },
        subject: { select: { id: true, name: true, type: true } },
      },
    });

    const hasMore = bookings.length > take;
    const data = hasMore ? bookings.slice(0, take) : bookings;
    return {
      data,
      meta: {
        cursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      },
    };
  }

  @Get('bookings/:id')
  async oneBooking(@Req() req: Request, @Param('id') id: string) {
    const { providerId } = this.ctx(req);
    return this.prisma.booking.findFirst({
      where: { id, providerId, isDeleted: false },
      include: {
        slot: true,
        customer: { select: { id: true, name: true, phone: true } },
        subject: true,
        provider: { select: { id: true, name: true, address: true, city: true } },
      },
    });
  }
}
