import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
  // When true, the Prisma tenant middleware will allow cross-tenant queries.
  // Set ONLY by code paths that intentionally need to operate across all tenants
  // (currently: the platform admin module). Everything else must set tenantId.
  bypassTenant?: boolean;
}

// Module-level singleton — imported by PrismaService to read the active tenant
export const tenantStorage = new AsyncLocalStorage<TenantStore>();
