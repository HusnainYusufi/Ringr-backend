import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
}

// Module-level singleton — imported by PrismaService to read the active tenant
export const tenantStorage = new AsyncLocalStorage<TenantStore>();
