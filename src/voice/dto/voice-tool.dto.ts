import { IsString, IsOptional, IsPhoneNumber } from 'class-validator';

// Retell wraps all tool calls with call context
export class RetellCallDto {
  @IsString()
  call_id: string;

  @IsString()
  agent_id: string;

  @IsOptional()
  @IsString()
  from_number?: string;
}

export class SendOtpToolDto {
  call: RetellCallDto;
  @IsPhoneNumber()
  phone: string;
}

export class VerifyOtpToolDto {
  call: RetellCallDto;
  @IsPhoneNumber()
  phone: string;
  @IsString()
  code: string;
}

export class GetSubjectsToolDto {
  call: RetellCallDto;
  @IsString()
  customer_id: string;
}

export class FindProvidersToolDto {
  call: RetellCallDto;
  @IsString()
  postal_code: string;
  @IsOptional()
  @IsString()
  subject_type?: string;
  @IsOptional()
  @IsString()
  visit_reason?: string;
  @IsOptional()
  @IsString()
  preferred_date?: string; // ISO date string "2025-03-15"
}

export class HoldSlotToolDto {
  call: RetellCallDto;
  @IsString()
  slot_id: string;
  @IsString()
  customer_id: string;
}

export class ConfirmBookingToolDto {
  call: RetellCallDto;
  @IsString()
  slot_id: string;
  @IsString()
  customer_id: string;
  @IsOptional()
  @IsString()
  subject_id?: string;
  @IsOptional()
  extra_fields?: Record<string, any>;
  @IsOptional()
  @IsString()
  notes?: string;
}
