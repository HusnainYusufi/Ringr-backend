import { IsPhoneNumber } from 'class-validator';

export class SendOtpDto {
  @IsPhoneNumber()
  phone: string;
}
