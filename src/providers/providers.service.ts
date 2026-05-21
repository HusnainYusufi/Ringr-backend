import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { SlotStatus } from '@prisma/client';

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.provider.create({ data: { ...dto, tenantId } });
  }

  async update(id: string, dto: Partial<CreateProviderDto>, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.provider.update({ where: { id }, data: dto });
  }

  async softDelete(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.provider.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
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
    const provider = await this.findOne(providerId, tenantId);
    const schedules = await this.prisma.providerSchedule.findMany({
      where: { providerId, isActive: true },
    });

    if (!schedules.length) {
      throw new BadRequestException('Provider has no active schedule configured');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const duration = dto.slotDurationMinutes;
    const slotsToCreate: any[] = [];

    const current = new Date(start);
    while (current <= end) {
      const dow = current.getDay();
      const schedule = schedules.find((s) => s.dayOfWeek === dow);

      if (schedule) {
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

    // createMany skips duplicates thanks to the @@unique constraint
    const result = await this.prisma.slot.createMany({
      data: slotsToCreate,
      skipDuplicates: true,
    });

    return { created: result.count, total: slotsToCreate.length };
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
