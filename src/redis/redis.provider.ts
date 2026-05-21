import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const client = new Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string>('redis.password'),
      lazyConnect: true,
    });

    client.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    return client;
  },
};
