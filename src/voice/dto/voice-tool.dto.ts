import { IsObject, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

// Retell wraps every tool call (and every webhook) with this `call` envelope.
export class RetellCallDto {
  @IsString()
  call_id: string;

  @IsString()
  agent_id: string;

  @IsOptional()
  @IsString()
  from_number?: string;

  @IsOptional()
  @IsString()
  to_number?: string;
}

// Retell sends tool params nested under "args": { ... }.
// All tool DTOs carry this field so NestJS whitelist mode doesn't strip it.
// Controllers extract from body.args first, falling back to top-level for
// direct / test calls.
export class GetSubjectsToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  args?: Record<string, any>;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsOptional()
  @IsString()
  provider_id?: string;
}

export class FindProvidersToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  args?: Record<string, any>;

  @IsOptional()
  @IsString()
  postal_code?: string;

  @IsOptional()
  @IsString()
  vertical_slug?: string;

  @IsOptional()
  @IsString()
  subject_type?: string;

  @IsOptional()
  @IsString()
  visit_reason?: string;

  @IsOptional()
  @IsString()
  preferred_date?: string;
}

export class HoldSlotToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  args?: Record<string, any>;

  // Optional at DTO level — Retell nests these under args.
  // Controller validates presence after extracting from the right location.
  @IsOptional()
  @IsString()
  slot_id?: string;

  @IsOptional()
  @IsString()
  provider_id?: string;
}

export class ConfirmBookingToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  args?: Record<string, any>;

  @IsOptional()
  @IsString()
  slot_id?: string;

  @IsOptional()
  @IsString()
  provider_id?: string;

  @IsOptional()
  @IsString()
  subject_id?: string;

  @IsOptional()
  extra_fields?: Record<string, any>;

  @IsOptional()
  @IsString()
  notes?: string;
}
