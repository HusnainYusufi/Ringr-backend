import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { VoiceModule } from './voice/voice.module';
import { GeoModule } from './geo/geo.module';
import { ProvidersModule } from './providers/providers.module';
import { BookingsModule } from './bookings/bookings.module';
import { CustomersModule } from './customers/customers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BillingModule } from './billing/billing.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    // Config — loaded globally so every module can inject ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // Event emitter for decoupled side effects (booking.confirmed → notifications)
    EventEmitterModule.forRoot(),

    // Rate limiting — short and long windows
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),

    // Bull queue — backed by Redis
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),

    PrismaModule,
    RedisModule,
    TenantModule,
    AuthModule,
    VoiceModule,
    GeoModule,
    ProvidersModule,
    BookingsModule,
    CustomersModule,
    NotificationsModule,
    AdminModule,
    AnalyticsModule,
    BillingModule,
    SubscriptionsModule,
    ApiKeysModule,
    IntegrationsModule,
  ],
  providers: [
    // Apply rate limiting to every route by default. Sensitive endpoints
    // (OTP, login) override with tighter @Throttle; Retell webhooks @SkipThrottle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
