import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // rawBody is required for Retell and Stripe HMAC signature verification
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port');
  const allowedOrigins = config.get<string[]>('allowedOrigins');

  // Security headers
  app.use(helmet());

  // Cookie parsing for httpOnly refresh token cookies
  app.use(cookieParser());

  // CORS — allow only our own frontend origins
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global validation — strips unknown fields, validates DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter — normalises all errors into consistent shape
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global transform interceptor — wraps all responses in { data, meta } envelope
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.listen(port);
  console.log(`Ringr backend running on http://localhost:${port}/api/v1`);
}

bootstrap();
