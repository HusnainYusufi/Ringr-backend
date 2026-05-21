import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Tenant } from '@prisma/client';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Tenant => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant;
  },
);
