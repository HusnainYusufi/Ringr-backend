import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsString()
  subdomain: string;

  @IsString()
  verticalId: string;
}

export class CreateTenantAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  isActive?: boolean;
}

export class CreateVerticalDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  config: Record<string, any>;
}
