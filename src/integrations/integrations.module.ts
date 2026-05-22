import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [ApiKeysModule],
  controllers: [IntegrationsController],
})
export class IntegrationsModule {}
