import { Global, Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantInterceptor } from './tenant.interceptor';
import { TenantBypassInterceptor } from './tenant-bypass.interceptor';

@Global()
@Module({
  providers: [TenantService, TenantInterceptor, TenantBypassInterceptor],
  exports: [TenantService, TenantInterceptor, TenantBypassInterceptor],
})
export class TenantModule {}
