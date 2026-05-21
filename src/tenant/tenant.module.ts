import { Global, Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantInterceptor } from './tenant.interceptor';

@Global()
@Module({
  providers: [TenantService, TenantInterceptor],
  exports: [TenantService, TenantInterceptor],
})
export class TenantModule {}
