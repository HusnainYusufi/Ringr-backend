import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub: string;       // userId (customerId or staffId)
  tenantId: string;
  role: string;
  providerId?: string;
  type: 'customer' | 'staff';
  email?: string;
  firstName?: string;
  lastName?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
