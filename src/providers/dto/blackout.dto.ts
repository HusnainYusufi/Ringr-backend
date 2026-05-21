import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateBlackoutDto {
  @IsDateString()
  startsAt: string; // ISO 8601; inclusive

  @IsDateString()
  endsAt: string; // ISO 8601; exclusive

  @IsOptional() @IsString()
  reason?: string;
}
