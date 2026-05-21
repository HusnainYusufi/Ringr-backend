import { SetMetadata } from '@nestjs/common';

// Routes with @SkipTenant() resolve no tenant; the TenantInterceptor sets
// bypassTenant=true in the AsyncLocalStorage instead. Used for endpoints
// that legitimately have no tenant context (e.g. accept-invite, where the
// tenant is encoded in the token itself).
export const SKIP_TENANT_KEY = 'skipTenant';
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);
