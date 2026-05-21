import { IsDateString, IsInt, Min, Max } from 'class-validator';

export class GenerateSlotsDto {
  @IsDateString()
  startDate: string; // ISO date "2025-03-17"

  @IsDateString()
  endDate: string; // ISO date "2025-03-23"

  @IsInt()
  @Min(15) @Max(120)
  slotDurationMinutes: number;
}
