import { IsEmail, IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateStaffDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEnum(Role)
  role: Role;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class ResetStaffPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}
