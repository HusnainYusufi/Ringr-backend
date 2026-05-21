import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import { tenantStorage } from './tenant.context';
import { SKIP_TENANT_KEY } from './skip-tenant.decorator';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly tenantService: TenantService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();

    // Routes with @SkipTenant() (e.g. accept-invite) resolve no tenant; the
    // Prisma middleware still demands SOMETHING in the store, so we set the
    // bypass flag and let the route handler use the token to find its own tenant.
    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipTenant) {
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

    const tenant = await this.tenantService.resolveFromRequest(request);
    request.tenant = tenant;

    // Run the rest of the request pipeline inside the tenant's AsyncLocalStorage context.
    // The PrismaService middleware reads tenantStorage.getStore() to auto-scope all queries.
    return new Observable((subscriber) => {
      tenantStorage.run({ tenantId: tenant.id }, () => {
        next.handle().subscribe({
          next: (val) => subscriber.next(val),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
