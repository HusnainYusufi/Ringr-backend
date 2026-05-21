import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports: [GeoModule],
  controllers: [ProvidersController, StaffController],
  providers: [ProvidersService, StaffService],
  exports: [ProvidersService, StaffService],
})
export class ProvidersModule {}
