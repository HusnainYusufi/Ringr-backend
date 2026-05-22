import {
  IsString,
  IsEmail,
  IsEnum,
  IsPhoneNumber,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

/**
 * SUPER_ADMIN single-shot onboarding payload.
 *
 * Creates: Provider (with auto-geocoded lat/lng if not supplied) + PROVIDER_OWNER
 * ProviderStaff (no password yet) + MagicLink emailed to the owner's address.
 */
export class OnboardProviderDto {
  // ── Tenant assignment ──
  // For now there's a single Ringr tenant; SUPER_ADMIN must still pass it
  // explicitly so the API is honest about the model and ready for the
  // (eventual) multi-tenant case.
  @IsString()
  tenantId: string;

  @IsString()
  verticalId: string;

  // ── Provider profile ──
  @IsString()
  name: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsOptional() @IsString()
  province?: string;

  @IsString()
  postalCode: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  lng?: number;

  @IsPhoneNumber()
  phone: string;

  @IsEmail()
  email: string;

  @IsOptional() @IsString()
  bio?: string;

  // ── Owner contact (receives the magic link) ──
  @IsEmail()
  ownerEmail: string;

  @IsString()
  ownerFirstName: string;

  @IsString()
  ownerLastName: string;

  // Defaults to STARTER (API + webhooks only) — vendors who want the portal
  // need PRO. SUPER_ADMIN can flip this later via /admin/subscriptions.
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;
}
