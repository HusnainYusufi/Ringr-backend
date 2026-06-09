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

export class GetSubjectsToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  // Needed in global-agent mode — tells us which tenant to search subjects in.
  @IsOptional()
  @IsString()
  provider_id?: string;
}

export class FindProvidersToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsOptional()
  @IsString()
  postal_code?: string;

  // "vet", "dental", "auto" etc. — normalised to canonical slug in GeoService.
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

  @IsString()
  slot_id: string;

  // Required in global-agent mode — tells us which provider (and therefore
  // tenant) this slot belongs to. The AI receives provider_id from find_providers.
  @IsString()
  provider_id: string;
}

export class ConfirmBookingToolDto {
  @IsObject()
  call: RetellCallDto;

  @IsString()
  slot_id: string;

  // Required in global-agent mode — same reason as HoldSlotToolDto.
  @IsString()
  provider_id: string;

  @IsOptional()
  @IsString()
  subject_id?: string;

  @IsOptional()
  extra_fields?: Record<string, any>;

  @IsOptional()
  @IsString()
  notes?: string;
}
