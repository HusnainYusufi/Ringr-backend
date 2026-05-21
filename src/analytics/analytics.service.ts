import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { Role, BookingStatus } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string, user: JwtPayload) {
    const providerFilter = this.getProviderFilter(user);

    const [
      totalBookings,
      confirmedBookings,
      cancelledBookings,
      completedBookings,
      totalCustomers,
      totalProviders,
      todayBookings,
    ] = await Promise.all([
      this.prisma.booking.count({ where: { ...providerFilter, isDeleted: false } }),
      this.prisma.booking.count({ where: { ...providerFilter, status: BookingStatus.CONFIRMED, isDeleted: false } }),
      this.prisma.booking.count({ where: { ...providerFilter, status: BookingStatus.CANCELLED, isDeleted: false } }),
      this.prisma.booking.count({ where: { ...providerFilter, status: BookingStatus.COMPLETED, isDeleted: false } }),
      this.prisma.customer.count({ where: { isDeleted: false } }),
      this.prisma.provider.count({ where: { isDeleted: false, isActive: true } }),
      this.prisma.booking.count({
        where: {
          ...providerFilter,
          isDeleted: false,
          createdAt: { gte: this.startOfDay() },
        },
      }),
    ]);

    const cancellationRate =
      totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

    return {
      totalBookings,
      confirmedBookings,
      cancelledBookings,
      completedBookings,
      cancellationRate,
      totalCustomers,
      totalProviders,
      todayBookings,
    };
  }

  async getBookingTrend(tenantId: string, user: JwtPayload, days = 30) {
    const providerFilter = this.getProviderFilter(user);
    const from = new Date();
    from.setDate(from.getDate() - days);

    const bookings = await this.prisma.booking.findMany({
      where: {
        ...providerFilter,
        isDeleted: false,
        createdAt: { gte: from },
      },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by day
    const byDay: Record<string, { date: string; confirmed: number; cancelled: number; total: number }> = {};

    for (const b of bookings) {
      const day = b.createdAt.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, confirmed: 0, cancelled: 0, total: 0 };
      byDay[day].total++;
      if (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.COMPLETED) {
        byDay[day].confirmed++;
      }
      if (b.status === BookingStatus.CANCELLED) {
        byDay[day].cancelled++;
      }
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getProviderPerformance(tenantId: string, user: JwtPayload) {
    const providerFilter = this.getProviderFilter(user);

    const providers = await this.prisma.provider.findMany({
      where: { isDeleted: false, ...(providerFilter.providerId && { id: providerFilter.providerId }) },
      select: { id: true, name: true, city: true },
    });

    const stats = await Promise.all(
      providers.map(async (p) => {
        const [total, confirmed, cancelled, completed] = await Promise.all([
          this.prisma.booking.count({ where: { providerId: p.id, isDeleted: false } }),
          this.prisma.booking.count({ where: { providerId: p.id, status: BookingStatus.CONFIRMED, isDeleted: false } }),
          this.prisma.booking.count({ where: { providerId: p.id, status: BookingStatus.CANCELLED, isDeleted: false } }),
          this.prisma.booking.count({ where: { providerId: p.id, status: BookingStatus.COMPLETED, isDeleted: false } }),
        ]);
        return { ...p, total, confirmed, cancelled, completed };
      }),
    );

    return stats.sort((a, b) => b.total - a.total);
  }

  private getProviderFilter(user: JwtPayload): { providerId?: string } {
    if (user.role === Role.PROVIDER_OWNER || user.role === Role.PROVIDER_STAFF) {
      return { providerId: user.providerId };
    }
    return {};
  }

  private startOfDay(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
