import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, isDeleted: false },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async updateProfile(customerId: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data: dto,
    });
  }

  async softDelete(customerId: string) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async getSubjects(customerId: string) {
    return this.prisma.subject.findMany({
      where: { customerId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSubject(customerId: string, tenantId: string, dto: CreateSubjectDto) {
    return this.prisma.subject.create({
      data: {
        tenantId,
        customerId,
        name: dto.name,
        type: dto.type,
        extraFields: dto.extraFields ?? {},
      },
    });
  }
}
