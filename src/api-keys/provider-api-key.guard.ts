import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiKeysService } from './api-keys.service';
import { tenantStorage } from '../tenant/tenant.context';

export interface ProviderApiKeyContext {
  keyId: string;
  providerId: string;
  tenantId: string;
}

/**
 * Authenticates vendor requests to /api/v1/integrations/*.
 *
 *   Authorization: Bearer rngr_<secret>
 *
 * On success, sets request.providerKey + enters the AsyncLocalStorage with
 * the resolved tenantId so the Prisma tenant middleware doesn't reject queries.
 *
 * Provider-scoping (auto-filtering queries to that provider's data) is the
 * caller's responsibility — the integrations controllers read providerKey
 * off the request and inject it into their where-clauses explicitly. We don't
 * try to do this in middleware because not every model has a providerId.
 */
@Injectable()
export class ProviderApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const header = (request.headers['authorization'] as string | undefined) ?? '';
    const [scheme, token] = header.split(' ', 2);

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing or malformed bearer token');
    }

    return this.resolveAndSet(request, token);
  }

  private async resolveAndSet(request: any, token: string): Promise<boolean> {
    const row = await this.apiKeys.resolveByPlaintext(token);
    if (!row) throw new UnauthorizedException('Invalid API key');

    const context: ProviderApiKeyContext = {
      keyId: row.id,
      providerId: row.providerId,
      tenantId: row.tenantId,
    };
    request.providerKey = context;
    request.tenant = { id: row.tenantId } as { id: string };

    // Enter the tenant store so Prisma middleware can auto-inject tenantId.
    // The Nest request lifecycle expects guards to be synchronous-ish, so we
    // also lazily set up storage via enterWith — that's the supported pattern
    // for guards (Node's AsyncLocalStorage v18+).
    tenantStorage.enterWith({ tenantId: row.tenantId });

    // Fire-and-forget lastUsedAt
    this.apiKeys.touchLastUsed(row.id);

    return true;
  }
}
