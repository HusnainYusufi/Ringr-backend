import { IsObject, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

// Retell wraps every tool call (and every webhook) with this `call` envelope.
// from_number is the caller's phone — that's how we identify them. No OTP.
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

export class GetSubjectsToolDto {
  @IsObject()
  call: RetellCallDto;

  // Optional — if not provided we fall back to call.from_number. The AI can
  // pass it explicitly if it needs to (e.g. operator looking up a different
  // number), but the standard path is "use whoever's on the line".
  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}

export class FindProvidersToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsString()
  postal_code: string;

  // Required in practice — without it we can't tell a pet booking from a
  // dental booking. Accepts shorthand: vet/dentist/auto get normalized to
  // the canonical slug in GeoService.
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
  preferred_date?: string; // ISO date or datetime
}

export class HoldSlotToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsString()
  slot_id: string;

  // Optional — backend resolves customer from call.from_number. We accept this
  // field for back-compat with Retell agents that still send it, but ignore it
  // if from_number is present (the source of truth).
  @IsOptional()
  @IsString()
  customer_id?: string;
}

export class ConfirmBookingToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsString()
  slot_id: string;

  // See HoldSlotToolDto.customer_id — kept optional for the same reason.
  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  subject_id?: string;

  @IsOptional()
  extra_fields?: Record<string, any>;

  @IsOptional()
  @IsString()
  notes?: string;
}
