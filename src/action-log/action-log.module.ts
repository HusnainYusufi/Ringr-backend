import { Global, Module } from '@nestjs/common';
import { ActionLogService } from './action-log.service';

@Global()
@Module({
  providers: [ActionLogService],
  exports: [ActionLogService],
})
export class ActionLogModule {}
