import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @IsInt() @Min(0) @Max(6)
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday

  @IsString() @Matches(HHMM, { message: 'startTime must be in HH:MM 24h format' })
  startTime: string;

  @IsString() @Matches(HHMM, { message: 'endTime must be in HH:MM 24h format' })
  endTime: string;

  @IsOptional() @IsInt() @Min(5) @Max(240)
  slotDurationMinutes?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional() @IsString() @Matches(HHMM)
  startTime?: string;

  @IsOptional() @IsString() @Matches(HHMM)
  endTime?: string;

  @IsOptional() @IsInt() @Min(5) @Max(240)
  slotDurationMinutes?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ReplaceWeekScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleDto)
  schedules: CreateScheduleDto[];
}
