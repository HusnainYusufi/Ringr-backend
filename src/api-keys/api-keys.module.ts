import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import {
  MyApiKeysController,
  AdminApiKeysController,
} from './api-keys.controller';
import { ProviderApiKeyGuard } from './provider-api-key.guard';

@Module({
  controllers: [MyApiKeysController, AdminApiKeysController],
  providers: [ApiKeysService, ProviderApiKeyGuard],
  exports: [ApiKeysService, ProviderApiKeyGuard],
})
export class ApiKeysModule {}
