import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantStorage } from './tenant.context';

// Used by platform-admin controllers that legitimately operate across all tenants.
// Sets bypassTenant=true so the Prisma tenant middleware allows the query through
// without injecting a tenantId filter. Without this (or TenantInterceptor),
// any query against a tenant-scoped model will throw.
@Injectable()
export class TenantBypassInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return new Observable((subscriber) => {
      tenantStorage.run({ tenantId: '', bypassTenant: true }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
