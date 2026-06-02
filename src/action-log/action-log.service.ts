import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LogAction {
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  targetType: string;
  targetId?: string;
  action: string;
  detail?: string;
  tenantId?: string;
}

@Injectable()
export class ActionLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: LogAction): Promise<void> {
    // Fire-and-forget — never let logging block the main flow
    this.prisma.actionLog
      .create({ data: entry })
      .catch((err) => console.error('[ActionLog] failed to write:', err));
  }

  async list(opts: { limit?: number; cursor?: string; tenantId?: string }) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: Record<string, unknown> = {};
    if (opts.cursor) where.id = { lt: opts.cursor };
    if (opts.tenantId) where.tenantId = opts.tenantId;

    const logs = await this.prisma.actionLog.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = logs.length > limit;
    const data = hasMore ? logs.slice(0, limit) : logs;
    return {
      data,
      meta: { cursor: hasMore ? data[data.length - 1].id : null, hasMore },
    };
  }
}
