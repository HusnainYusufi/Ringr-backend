import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? message;
      code = this.httpStatusToCode(statusCode);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ statusCode, message, code } = this.handlePrismaError(exception));
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      code = 'VALIDATION_ERROR';
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    // Don't log 4xx as errors — they're expected client mistakes
    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      error: {
        message: Array.isArray(message) ? message.join(', ') : message,
        code,
        statusCode,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }

  private handlePrismaError(e: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
    code: string;
  } {
    switch (e.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with this value already exists',
          code: 'DUPLICATE_RECORD',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          code: 'NOT_FOUND',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Related record not found',
          code: 'FOREIGN_KEY_VIOLATION',
        };
      default:
        this.logger.error(`Prisma error ${e.code}: ${e.message}`);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          code: 'DATABASE_ERROR',
        };
    }
  }

  private httpStatusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
