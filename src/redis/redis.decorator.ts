import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.provider';

export const InjectRedis = () => Inject(REDIS_CLIENT);
