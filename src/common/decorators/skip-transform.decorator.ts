import { SetMetadata } from '@nestjs/common';

// Routes with @SkipTransform() bypass the global TransformInterceptor — they
// return their bodies verbatim instead of being wrapped in { data, meta }.
// Used for endpoints where an external consumer (Retell tools, vendor
// webhooks) expects a specific top-level shape.
export const SKIP_TRANSFORM_KEY = 'skipTransform';
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
