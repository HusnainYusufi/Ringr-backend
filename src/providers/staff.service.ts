import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto, UpdateStaffDto, ResetStaffPasswordDto } from './dto/create-staff.dto';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(providerId: string, tenantId: string) {
    return this.prisma.providerStaff.findMany({
      where: { providerId, isDeleted: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(providerId: string, tenantId: string, dto: CreateStaffDto, caller: JwtPayload) {
    // Only OWNER or TENANT_ADMIN can add staff
    if (
      caller.role !== Role.PROVIDER_OWNER &&
      caller.role !== Role.TENANT_ADMIN &&
      caller.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException('Only owners and admins can add staff');
    }

    const existing = await this.prisma.providerStaff.findFirst({
      where: { email: dto.email, isDeleted: false },
    });
    if (existing) throw new ConflictException('A staff member with that email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const staff = await this.prisma.providerStaff.create({
      data: {
        tenantId,
        providerId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
      },
    });

    const { passwordHash: _, ...safe } = staff;
    return safe;
  }

  async update(staffId: string, tenantId: string, dto: UpdateStaffDto) {
    const staff = await this.prisma.providerStaff.findFirst({
      where: { id: staffId, isDeleted: false },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    return this.prisma.providerStaff.update({
      where: { id: staffId },
      data: dto,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
  }

  async resetPassword(staffId: string, tenantId: string, dto: ResetStaffPasswordDto) {
    const staff = await this.prisma.providerStaff.findFirst({
      where: { id: staffId, isDeleted: false },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.providerStaff.update({
      where: { id: staffId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async deactivate(staffId: string, tenantId: string) {
    const staff = await this.prisma.providerStaff.findFirst({
      where: { id: staffId, isDeleted: false },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    return this.prisma.providerStaff.update({
      where: { id: staffId },
      data: { isActive: false },
      select: { id: true, email: true, isActive: true },
    });
  }

  async softDelete(staffId: string, tenantId: string) {
    const staff = await this.prisma.providerStaff.findFirst({
      where: { id: staffId, isDeleted: false },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    await this.prisma.providerStaff.update({
      where: { id: staffId },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });

    return { deleted: true };
  }
}
