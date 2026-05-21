import {
  IsString,
  IsEmail,
  IsPhoneNumber,
  IsNumber,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class CreateProviderDto {
  @IsString()
  name: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsString()
  province: string;

  @IsString()
  postalCode: string;

  // lat/lng are optional now — if omitted, the service geocodes from postalCode.
  @IsOptional()
  @IsNumber()
  @Min(-90) @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180) @Max(180)
  lng?: number;

  @IsPhoneNumber()
  phone: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  verticalId?: string;
}
