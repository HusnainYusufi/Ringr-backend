import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findByApiKey(apiKey: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { apiKey } });
  }

  async findBySubdomain(subdomain: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { subdomain } });
  }

  async findByRetellAgentId(agentId: string): Promise<Tenant | null> {
    const agent = await this.prisma.retellAgent.findUnique({
      where: { agentId },
      include: { tenant: true },
    });
    return agent?.tenant ?? null;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async resolveFromRequest(req: any): Promise<Tenant> {
    // Priority 1: API key header (used by Next.js portal server-side calls)
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const tenant = await this.findByApiKey(apiKey);
      if (!tenant) throw new UnauthorizedException('Invalid API key');
      if (!tenant.isActive) throw new UnauthorizedException('Tenant is inactive');
      return tenant;
    }

    // Priority 2: Retell agent ID in request body (voice webhook calls)
    const agentId = req.body?.agent_id ?? req.body?.call?.agent_id;
    if (agentId) {
      const tenant = await this.findByRetellAgentId(agentId);
      if (tenant) {
        if (!tenant.isActive) throw new UnauthorizedException('Tenant is inactive');
        return tenant;
      }
    }

    // Priority 3: Subdomain from Host header (browser requests)
    const host = req.headers['host'] as string;
    if (host) {
      const subdomain = this.extractSubdomain(host);
      if (subdomain) {
        const tenant = await this.findBySubdomain(subdomain);
        if (tenant) {
          if (!tenant.isActive) throw new UnauthorizedException('Tenant is inactive');
          return tenant;
        }
      }
    }

    throw new UnauthorizedException('Could not resolve tenant');
  }

  private extractSubdomain(host: string): string | null {
    // Strip port if present
    const hostname = host.split(':')[0];
    const parts = hostname.split('.');
    // e.g. vetconnect.ringr.ca → ["vetconnect", "ringr", "ca"]
    if (parts.length >= 3) return parts[0];
    // e.g. vetconnect.localhost → ["vetconnect", "localhost"]
    if (parts.length === 2 && parts[1] === 'localhost') return parts[0];
    return null;
  }
}
