import { IsString, IsOptional } from 'class-validator';

export class CreateSubjectDto {
  @IsString()
  name: string;

  @IsString()
  type: string; // "dog", "cat", "tooth", "car", etc.

  @IsOptional()
  extraFields?: Record<string, any>;
}
