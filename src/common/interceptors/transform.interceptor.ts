import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    [key: string]: any;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // If the controller already returned an envelope (data + meta), pass through
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
