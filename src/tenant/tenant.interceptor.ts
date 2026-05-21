import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantService } from './tenant.service';
import { tenantStorage } from './tenant.context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantService: TenantService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();

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
