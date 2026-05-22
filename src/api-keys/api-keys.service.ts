import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedApiKey {
  id: string;
  name: string;
  // The full plaintext secret. Returned ONCE, on issuance. After that we only
  // have the SHA-256 hash and a display tail.
  plaintext: string;
  keyPrefix: string;
  lastFour: string;
  createdAt: Date;
}

/**
 * Provider API keys for vendor integrations.
 *
 * Format:   rngr_<32 hex chars>     — total length 37
 * At rest:  SHA-256(plaintext) in keyHash; first 8 chars in keyPrefix; last 4
 *           in lastFour for UI display.
 *
 * The plaintext is returned exactly once at issuance time. Callers must store
 * it themselves; if they lose it they have to revoke and reissue.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * SUPER_ADMIN convenience: resolves the tenant from the provider, then issues.
   * Used when the caller doesn't already have the tenantId in scope.
   */
  async issueKeyForProvider(providerId: string, name: string): Promise<IssuedApiKey> {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { tenantId: true, isDeleted: true },
    });
    if (!provider || provider.isDeleted) {
      throw new NotFoundException('Provider not found');
    }
    return this.issueKey(providerId, provider.tenantId, name);
  }

  async issueKey(
    providerId: string,
    tenantId: string,
    name: string,
  ): Promise<IssuedApiKey> {
    const plaintext = `rngr_${crypto.randomBytes(16).toString('hex')}`;
    const keyHash = this.hash(plaintext);
    const keyPrefix = plaintext.slice(0, 8); // "rngr_" + 3 chars
    const lastFour = plaintext.slice(-4);

    // Hash collisions are astronomically improbable, but the unique constraint
    // makes the failure mode crisp if one ever occurs.
    try {
      const row = await this.prisma.providerApiKey.create({
        data: { tenantId, providerId, name, keyHash, keyPrefix, lastFour },
      });
      return {
        id: row.id,
        name: row.name,
        plaintext,
        keyPrefix,
        lastFour,
        createdAt: row.createdAt,
      };
    } catch {
      throw new ConflictException('Key collision — retry');
    }
  }

  async listForProvider(providerId: string) {
    return this.prisma.providerApiKey.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      // Explicitly exclude keyHash. lastFour + keyPrefix are safe to expose.
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastFour: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(providerId: string, keyId: string) {
    const key = await this.prisma.providerApiKey.findFirst({
      where: { id: keyId, providerId },
    });
    if (!key) throw new NotFoundException('API key not found');
    if (key.revokedAt) return key; // idempotent
    return this.prisma.providerApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Look up an API key for authentication. Returns the matching row + provider
   * context if the secret is valid and the key isn't revoked.
   *
   * We hash the presented plaintext and look up by hash (no need for a
   * constant-time compare — bcrypt-style attacks don't apply to indexed
   * hash equality).
   */
  async resolveByPlaintext(plaintext: string) {
    if (!plaintext.startsWith('rngr_')) return null;
    const keyHash = this.hash(plaintext);
    const row = await this.prisma.providerApiKey.findUnique({
      where: { keyHash },
      include: {
        provider: { select: { id: true, tenantId: true, isActive: true, isDeleted: true } },
      },
    });
    if (!row || row.revokedAt) return null;
    if (!row.provider || row.provider.isDeleted || !row.provider.isActive) return null;
    return row;
  }

  /** Fire-and-forget lastUsedAt bump. Don't block the request on it. */
  async touchLastUsed(keyId: string): Promise<void> {
    this.prisma.providerApiKey
      .update({ where: { id: keyId }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        /* swallow — purely cosmetic */
      });
  }

  private hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }
}
