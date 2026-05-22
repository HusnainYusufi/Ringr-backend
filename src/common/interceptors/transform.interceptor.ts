import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

export interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    [key: string]: any;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  // Reflector instantiated locally so this works when registered globally via
  // useGlobalInterceptors(new TransformInterceptor()) outside the DI graph.
  private readonly reflector = new Reflector();

  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => {
        // Routes with @SkipTransform() return their bodies verbatim. Used by
        // Retell tool endpoints and any other external integration that needs
        // a fixed top-level shape.
        if (skip) return data;

        // If the controller already returned an envelope (data + meta), pass through.
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          return data;
        }
        return {
          data,
          meta: { timestamp: new Date().toISOString() },
        };
      }),
    );
  }
}
