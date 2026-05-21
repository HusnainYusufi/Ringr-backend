import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  CreateVerticalDto,
  CreateTenantAdminDto,
} from './dto/create-tenant.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Verticals ────────────────────────────────────────────────────────────

  async listVerticals() {
    return this.prisma.vertical.findMany({ orderBy: { name: 'asc' } });
  }

  async createVertical(dto: CreateVerticalDto) {
    const existing = await this.prisma.vertical.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('A vertical with this slug already exists');

    return this.prisma.vertical.create({ data: dto });
  }

  async updateVertical(id: string, config: Record<string, any>) {
    const vertical = await this.prisma.vertical.findUnique({ where: { id } });
    if (!vertical) throw new NotFoundException('Vertical not found');
    return this.prisma.vertical.update({ where: { id }, data: { config } });
  }

  // ─── Tenants ──────────────────────────────────────────────────────────────

  async listTenants() {
    return this.prisma.tenant.findMany({
      include: { vertical: true, _count: { select: { providers: true, customers: true, bookings: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        vertical: true,
        providers: { where: { isDeleted: false }, select: { id: true, name: true, city: true, isActive: true } },
        retellAgents: true,
        _count: { select: { customers: true, bookings: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async createTenant(dto: CreateTenantDto) {
    const slugExists = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (slugExists) throw new ConflictException('Slug already taken');

    const subdomainExists = await this.prisma.tenant.findUnique({ where: { subdomain: dto.subdomain } });
    if (subdomainExists) throw new ConflictException('Subdomain already taken');

    const vertical = await this.prisma.vertical.findUnique({ where: { id: dto.verticalId } });
    if (!vertical) throw new NotFoundException('Vertical not found');

    // Generate a unique API key
    const apiKey = `rng-${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    return this.prisma.tenant.create({
      data: { ...dto, apiKey },
      include: { vertical: true },
    });
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async rotateTenantApiKey(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const apiKey = `rng-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    return this.prisma.tenant.update({ where: { id }, data: { apiKey } });
  }

  async registerRetellAgent(tenantId: string, agentId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return this.prisma.retellAgent.upsert({
      where: { agentId },
      update: { tenantId },
      create: { agentId, tenantId },
    });
  }

  // ─── Tenant admin accounts ─────────────────────────────────────────────────

  async createTenantAdmin(tenantId: string, providerId: string, dto: CreateTenantAdminDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const exists = await this.prisma.providerStaff.findFirst({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const staff = await this.prisma.providerStaff.create({
      data: {
        tenantId,
        providerId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: 'TENANT_ADMIN',
      },
    });

    const { passwordHash: _, ...safe } = staff;
    return safe;
  }

  // ─── Platform stats ────────────────────────────────────────────────────────

  async getPlatformStats() {
    const [tenantCount, providerCount, customerCount, bookingCount] = await Promise.all([
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.provider.count({ where: { isDeleted: false } }),
      this.prisma.customer.count({ where: { isDeleted: false } }),
      this.prisma.booking.count({ where: { isDeleted: false } }),
    ]);

    return { tenantCount, providerCount, customerCount, bookingCount };
  }
}
