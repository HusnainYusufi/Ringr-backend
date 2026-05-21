import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from '../geo/geo.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  ReplaceWeekScheduleDto,
} from './dto/schedule.dto';
import { CreateBlackoutDto } from './dto/blackout.dto';
import { BookingStatus, SlotStatus } from '@prisma/client';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.provider.findMany({
      where: { isDeleted: false },
      include: { staff: { where: { isDeleted: false }, select: { id: true, firstName: true, lastName: true, role: true, email: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const provider = await this.prisma.provider.findFirst({
      where: { id, isDeleted: false },
      include: {
        schedules: { where: { isActive: true } },
        staff: { where: { isDeleted: false }, select: { id: true, firstName: true, lastName: true, role: true, email: true } },
      },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    return provider;
  }

  async create(dto: CreateProviderDto, tenantId: string) {
    // Auto-geocode if lat/lng weren't supplied — ops should be able to onboard
    // a clinic by typing in the postal code without looking up coordinates.
    let { lat, lng } = dto;
    if (lat == null || lng == null) {
      const coords = await this.geo.geocodePostalCode(dto.postalCode);
      lat = coords.lat;
      lng = coords.lng;
    }
    return this.prisma.provider.create({
      data: { ...dto, lat, lng, tenantId },
    });
  }

  async update(id: string, dto: Partial<CreateProviderDto>, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.provider.update({ where: { id }, data: dto });
  }

  // ─── Schedule CRUD ─────────────────────────────────────────────────────────

  async listSchedules(providerId: string, tenantId: string) {
    await this.findOne(providerId, tenantId);
    return this.prisma.providerSchedule.findMany({
      where: { providerId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async createSchedule(providerId: string, dto: CreateScheduleDto, tenantId: string) {
    await this.findOne(providerId, tenantId);
    this.assertTimeRange(dto.startTime, dto.endTime);

    const existing = await this.prisma.providerSchedule.findFirst({
      where: { providerId, dayOfWeek: dto.dayOfWeek },
    });
    if (existing) {
      throw new BadRequestException(
        `A schedule already exists for dayOfWeek=${dto.dayOfWeek}. PATCH or replace instead.`,
      );
    }

    return this.prisma.providerSchedule.create({
      data: {
        providerId,
        tenantId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        slotDurationMinutes: dto.slotDurationMinutes ?? 30,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSchedule(
    providerId: string,
    scheduleId: string,
    dto: UpdateScheduleDto,
    tenantId: string,
  ) {
    const schedule = await this.prisma.providerSchedule.findFirst({
      where: { id: scheduleId, providerId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    if (dto.startTime || dto.endTime) {
      this.assertTimeRange(
        dto.startTime ?? schedule.startTime,
        dto.endTime ?? schedule.endTime,
      );
    }

    return this.prisma.providerSchedule.update({
      where: { id: scheduleId },
      data: dto,
    });
  }

  async deleteSchedule(providerId: string, scheduleId: string, tenantId: string) {
    const schedule = await this.prisma.providerSchedule.findFirst({
      where: { id: scheduleId, providerId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return this.prisma.providerSchedule.delete({ where: { id: scheduleId } });
  }

  // "Set my opening hours" — replace the whole weekly schedule in one transaction.
  async replaceWeekSchedule(
    providerId: string,
    dto: ReplaceWeekScheduleDto,
    tenantId: string,
  ) {
    await this.findOne(providerId, tenantId);

    for (const s of dto.schedules) this.assertTimeRange(s.startTime, s.endTime);

    const seenDays = new Set<number>();
    for (const s of dto.schedules) {
      if (seenDays.has(s.dayOfWeek)) {
        throw new BadRequestException(`Duplicate dayOfWeek=${s.dayOfWeek}`);
      }
      seenDays.add(s.dayOfWeek);
    }

    return this.prisma.$transaction([
      this.prisma.providerSchedule.deleteMany({ where: { providerId } }),
      this.prisma.providerSchedule.createMany({
        data: dto.schedules.map((s) => ({
          providerId,
          tenantId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          slotDurationMinutes: s.slotDurationMinutes ?? 30,
          isActive: s.isActive ?? true,
        })),
      }),
    ]);
  }

  private assertTimeRange(startTime: string, endTime: string) {
    if (startTime >= endTime) {
      throw new BadRequestException(`startTime (${startTime}) must be before endTime (${endTime})`);
    }
  }

  async softDelete(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.provider.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
  }

  // ─── "Me" / dashboard ──────────────────────────────────────────────────────

  /** Provider profile of the currently-logged-in staff member. */
  async findMyProvider(user: JwtPayload, tenantId: string) {
    if (!user.providerId) {
      throw new NotFoundException('No provider attached to this account');
    }
    return this.findOne(user.providerId, tenantId);
  }

  /**
   * Aggregated dashboard payload for the portal home page. Returns everything
   * the navbar/landing page typically needs in one round-trip.
   */
  async myDashboard(user: JwtPayload, tenantId: string) {
    if (!user.providerId) {
      throw new NotFoundException('No provider attached to this account');
    }

    const providerId = user.providerId;

    // Day boundaries in the server's local timezone. Toronto is the de-facto
    // app timezone everywhere else; using local TZ stays consistent with that.
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);   endOfToday.setHours(23, 59, 59, 999);

    const sevenDaysAhead = new Date(startOfToday); sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);

    // Start of current week (Sunday).
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const baseWhere = { providerId, isDeleted: false };

    const [
      provider,
      todaysAppointments,
      todayCount,
      upcomingCount,
      thisWeekConfirmed,
      thisWeekCompleted,
      thisWeekCancelled,
      thisWeekNoShow,
    ] = await this.prisma.$transaction([
      this.prisma.provider.findFirst({
        where: { id: providerId, isDeleted: false },
        include: { vertical: true },
      }),
      this.prisma.booking.findMany({
        where: {
          ...baseWhere,
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
          slot: { startsAt: { gte: startOfToday, lte: endOfToday } },
        },
        include: {
          slot: true,
          customer: { select: { id: true, name: true, phone: true } },
          subject: { select: { id: true, name: true, type: true } },
        },
        orderBy: { slot: { startsAt: 'asc' } },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
          slot: { startsAt: { gte: startOfToday, lte: endOfToday } },
        },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: BookingStatus.CONFIRMED,
          slot: { startsAt: { gt: endOfToday, lte: sevenDaysAhead } },
        },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: BookingStatus.CONFIRMED,
          slot: { startsAt: { gte: startOfWeek } },
        },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: startOfWeek },
        },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: BookingStatus.CANCELLED,
          cancelledAt: { gte: startOfWeek },
        },
      }),
      this.prisma.booking.count({
        where: {
          ...baseWhere,
          status: BookingStatus.NO_SHOW,
          slot: { startsAt: { gte: startOfWeek } },
        },
      }),
    ]);

    if (!provider) throw new NotFoundException('Provider not found');

    return {
      provider,
      today: {
        count: todayCount,
        appointments: todaysAppointments,
      },
      upcoming: {
        next7Days: upcomingCount,
      },
      thisWeek: {
        confirmed: thisWeekConfirmed,
        completed: thisWeekCompleted,
        cancelled: thisWeekCancelled,
        noShow: thisWeekNoShow,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Slots ─────────────────────────────────────────────────────────────────

  async getSlots(
    providerId: string,
    tenantId: string,
    from?: string,
    to?: string,
    status?: SlotStatus,
  ) {
    const where: any = { providerId, ...(status && { status }) };
    if (from || to) {
      where.startsAt = {};
      if (from) where.startsAt.gte = new Date(from);
      if (to) where.startsAt.lte = new Date(to);
    }
    return this.prisma.slot.findMany({ where, orderBy: { startsAt: 'asc' } });
  }

  async generateSlots(providerId: string, dto: GenerateSlotsDto, tenantId: string) {
    await this.findOne(providerId, tenantId);
    const schedules = await this.prisma.providerSchedule.findMany({
      where: { providerId, isActive: true },
    });

    if (!schedules.length) {
      throw new BadRequestException('Provider has no active schedule configured');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const duration = dto.slotDurationMinutes;

    // Pull blackouts that overlap [start, end] so the inner loop can skip
    // dates the provider has marked unavailable.
    const blackouts = await this.prisma.providerBlackout.findMany({
      where: {
        providerId,
        startsAt: { lt: new Date(end.getTime() + 24 * 60 * 60 * 1000) },
        endsAt: { gt: start },
      },
      select: { startsAt: true, endsAt: true },
    });
    const isBlackedOut = (date: Date) =>
      blackouts.some((b) => date >= b.startsAt && date < b.endsAt);

    const slotsToCreate: any[] = [];
    const current = new Date(start);
    while (current <= end) {
      const dow = current.getDay();
      const schedule = schedules.find((s) => s.dayOfWeek === dow);

      if (schedule && !isBlackedOut(current)) {
        const [startH, startM] = schedule.startTime.split(':').map(Number);
        const [endH, endM] = schedule.endTime.split(':').map(Number);

        const slotStart = new Date(current);
        slotStart.setHours(startH, startM, 0, 0);

        const dayEnd = new Date(current);
        dayEnd.setHours(endH, endM, 0, 0);

        while (slotStart < dayEnd) {
          const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
          if (slotEnd > dayEnd) break;

          slotsToCreate.push({
            tenantId,
            providerId,
            startsAt: new Date(slotStart),
            endsAt: new Date(slotEnd),
            status: SlotStatus.AVAILABLE,
          });

          slotStart.setTime(slotStart.getTime() + duration * 60 * 1000);
        }
      }

      current.setDate(current.getDate() + 1);
    }

    const result = await this.prisma.slot.createMany({
      data: slotsToCreate,
      skipDuplicates: true,
    });

    return { created: result.count, total: slotsToCreate.length };
  }

  // ─── Blackouts ─────────────────────────────────────────────────────────────

  async listBlackouts(providerId: string, tenantId: string) {
    await this.findOne(providerId, tenantId);
    return this.prisma.providerBlackout.findMany({
      where: { providerId },
      orderBy: { startsAt: 'asc' },
    });
  }

  async createBlackout(providerId: string, dto: CreateBlackoutDto, tenantId: string) {
    await this.findOne(providerId, tenantId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(startsAt < endsAt)) {
      throw new BadRequestException('startsAt must be before endsAt');
    }

    // Side-effect: block any AVAILABLE slots that fall inside the new blackout,
    // so the AI agent can't book them. Booked slots are left alone — that's
    // a conflict the provider has to resolve manually (cancel + rebook).
    const [blackout] = await this.prisma.$transaction([
      this.prisma.providerBlackout.create({
        data: {
          tenantId,
          providerId,
          startsAt,
          endsAt,
          reason: dto.reason,
        },
      }),
      this.prisma.slot.updateMany({
        where: {
          providerId,
          status: SlotStatus.AVAILABLE,
          startsAt: { gte: startsAt, lt: endsAt },
        },
        data: { status: SlotStatus.BLOCKED },
      }),
    ]);

    // Surface any conflicts so the portal can warn the provider.
    const conflicts = await this.prisma.booking.findMany({
      where: {
        providerId,
        status: BookingStatus.CONFIRMED,
        slot: { startsAt: { gte: startsAt, lt: endsAt } },
      },
      select: { id: true, slot: { select: { startsAt: true } } },
    });

    return { blackout, conflictingBookings: conflicts };
  }

  async deleteBlackout(providerId: string, blackoutId: string, tenantId: string) {
    const blackout = await this.prisma.providerBlackout.findFirst({
      where: { id: blackoutId, providerId },
    });
    if (!blackout) throw new NotFoundException('Blackout not found');

    // Restore: any slot in the range that WE blocked (status BLOCKED) goes
    // back to AVAILABLE. We can't perfectly distinguish "blocked by blackout"
    // from "blocked manually", but the simple heuristic of "any BLOCKED slot
    // inside the range" is fine for v1.
    await this.prisma.$transaction([
      this.prisma.providerBlackout.delete({ where: { id: blackoutId } }),
      this.prisma.slot.updateMany({
        where: {
          providerId,
          status: SlotStatus.BLOCKED,
          startsAt: { gte: blackout.startsAt, lt: blackout.endsAt },
        },
        data: { status: SlotStatus.AVAILABLE },
      }),
    ]);

    return { deleted: true };
  }

  async updateSlot(
    providerId: string,
    slotId: string,
    status: SlotStatus,
    tenantId: string,
  ) {
    const slot = await this.prisma.slot.findFirst({ where: { id: slotId, providerId } });
    if (!slot) throw new NotFoundException('Slot not found');
    return this.prisma.slot.update({ where: { id: slotId }, data: { status } });
  }
}
