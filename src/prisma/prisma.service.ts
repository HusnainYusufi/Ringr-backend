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

    // Tenant isolation middleware — automatically scopes every query to the active tenant
    this.$use(async (params, next) => {
      const store = tenantStorage.getStore();
      const tenantId = store?.tenantId;

      if (!tenantId || !TENANT_SCOPED_MODELS.has(params.model)) {
        return next(params);
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
