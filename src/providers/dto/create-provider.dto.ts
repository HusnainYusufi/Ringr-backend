import { IsString, IsEmail, IsPhoneNumber, IsNumber, IsOptional, Min, Max } from 'class-validator';

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

  @IsNumber()
  @Min(-90) @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  lng: number;

  @IsPhoneNumber()
  phone: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
