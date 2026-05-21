import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TenantInterceptor } from '../tenant/tenant.interceptor';
import { Tenant } from '@prisma/client';

@Controller('customers/me')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.customersService.getProfile(user.sub);
  }

  @Patch()
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCustomerDto) {
    return this.customersService.updateProfile(user.sub, dto);
  }

  @Delete()
  deleteAccount(@CurrentUser() user: JwtPayload) {
    return this.customersService.softDelete(user.sub);
  }

  @Get('subjects')
  getSubjects(@CurrentUser() user: JwtPayload) {
    return this.customersService.getSubjects(user.sub);
  }

  @Post('subjects')
  createSubject(
    @CurrentUser() user: JwtPayload,
    @CurrentTenant() tenant: Tenant,
    @Body() dto: CreateSubjectDto,
  ) {
    return this.customersService.createSubject(user.sub, tenant.id, dto);
  }
}
