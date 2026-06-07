import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { SubscriptionTier } from '@prisma/client';

/**
 * SUPER_ADMIN sends ONLY the clinic owner's details + vertical assignment.
 * The owner fills in clinic details (address, hours, etc.) themselves after
 * accepting their invite. This keeps admin out of the owner's business.
 */
export class OnboardProviderDto {
  // tenantId is now auto-resolved from verticalId on the backend.
  // Admin only picks the vertical — no need to know about tenants.

  @IsString()
  verticalId: string;

  // ── Owner contact ──
  @IsEmail()
  ownerEmail: string;

  @IsString()
  ownerFirstName: string;

  @IsString()
  ownerLastName: string;

  // Optional clinic name — if not provided we default to "<FirstName>'s Clinic"
  // so the provider row is human-readable in the admin list from day 1.
  @IsOptional()
  @IsString()
  clinicName?: string;

  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;
}
