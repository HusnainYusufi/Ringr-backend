import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantStorage } from '../tenant/tenant.context';

const TENANT_SCOPED_MODELS = new Set([
  'Provider',
  'ProviderStaff',
  'ProviderSchedule',
  'Slot',
  'Customer',
  'Subject',
  'Booking',
  'CallSession',
  'RefreshToken',
  'RetellAgent',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

    // Tenant isolation middleware — automatically scopes every query to the active tenant.
    //
    // Defense in depth: if a request touches a tenant-scoped model without setting up
    // the tenant context (e.g. a new controller forgets @UseInterceptors(TenantInterceptor)),
    // we refuse the query rather than silently returning cross-tenant data. The only
    // legitimate way to query without a tenantId is to set `bypassTenant: true` in the
    // store — currently used by the platform admin module.
    this.$use(async (params, next) => {
      const store = tenantStorage.getStore();
      const tenantId = store?.tenantId;
      const bypass = store?.bypassTenant === true;

      if (!TENANT_SCOPED_MODELS.has(params.model)) {
        return next(params);
      }

      if (bypass) {
        return next(params);
      }

      if (!tenantId) {
        throw new Error(
          `Tenant context missing for query on ${params.model}.${params.action}. ` +
            `Apply TenantInterceptor on the controller, or set bypassTenant for admin paths.`,
        );
      }

      if (params.action === 'create') {
        params.args.data = { ...params.args.data, tenantId };
      }

      if (params.action === 'createMany') {
        params.args.data = params.args.data.map((d: any) => ({ ...d, tenantId }));
      }

      // Convert findUnique → findFirst so we can inject tenantId into where
      if (params.action === 'findUnique') {
        params.action = 'findFirst';
        params.args.where = { ...params.args.where, tenantId };
      }
      if (params.action === 'findUniqueOrThrow') {
        params.action = 'findFirstOrThrow';
        params.args.where = { ...params.args.where, tenantId };
      }

      if (
        ['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'].includes(
          params.action,
        )
      ) {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
      }

      if (['update', 'updateMany', 'delete', 'deleteMany'].includes(params.action)) {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
      }

      if (params.action === 'upsert') {
        params.args.where = { ...params.args.where, tenantId };
        params.args.create = { ...params.args.create, tenantId };
        // update block intentionally does NOT set tenantId (can't change tenant)
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
