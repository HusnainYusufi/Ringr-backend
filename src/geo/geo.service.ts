import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InjectRedis } from '../redis/redis.decorator';
import type Redis from 'ioredis';
import { Provider, Slot } from '@prisma/client';

const SEARCH_RADIUS_KM = 25;
const GEO_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
// Voice agent is waiting on the line — a stalled geocode call holds the entire
// conversation. Fail fast and fall back to demo coords rather than block.
const GEOCODE_TIMEOUT_MS = 3_000;
// Demo-mode fixed coordinate: Toronto downtown
const DEMO_COORDINATE = { lat: 43.6532, lng: -79.3832 };

// Common shorthand callers (or AI agents) might use for the three seeded
// verticals. Matched case-insensitively. Inputs not in this map fall through
// unchanged so adding a new Vertical row with a fresh slug just works.
const VERTICAL_SLUG_ALIASES: Record<string, string> = {
  // veterinary
  vet: 'veterinary',
  vets: 'veterinary',
  veterinarian: 'veterinary',
  veterinary: 'veterinary',
  // dental
  dental: 'dental',
  dentist: 'dental',
  dentistry: 'dental',
  teeth: 'dental',
  // automotive
  auto: 'automotive',
  automotive: 'automotive',
  car: 'automotive',
  garage: 'automotive',
  mechanic: 'automotive',
  mechanical: 'automotive',
};

function normalizeVerticalSlug(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const lower = input.trim().toLowerCase();
  return VERTICAL_SLUG_ALIASES[lower] ?? lower;
}

export interface ProviderWithSlot {
  provider: Provider;
  slot: Slot;
  distanceKm: number;
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── Geocoding ────────────────────────────────────────────────────────────

  async geocodePostalCode(postalCode: string): Promise<{ lat: number; lng: number }> {
    const demoMode = this.config.get<boolean>('demoMode');
    if (demoMode) return DEMO_COORDINATE;

    const cacheKey = `geo:postal:${postalCode.toUpperCase().replace(/\s/g, '')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const apiKey = this.config.get<string>('googleMaps.apiKey');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(postalCode)}&components=country:CA&key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();

      if (data.status !== 'OK' || !data.results.length) {
        this.logger.warn(`Geocoding failed for ${postalCode}: ${data.status}`);
        return DEMO_COORDINATE; // Graceful fallback
      }

      const { lat, lng } = data.results[0].geometry.location;
      const coords = { lat, lng };

      await this.redis.setex(cacheKey, GEO_CACHE_TTL, JSON.stringify(coords));
      return coords;
    } catch (err) {
      this.logger.warn(
        `Geocoding error for ${postalCode}: ${err instanceof Error ? err.message : err}`,
      );
      return DEMO_COORDINATE;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Global marketplace search (no tenant filter) ────────────────────────
  // Used by the single global Retell agent — searches ALL active providers
  // across every tenant, filtered only by vertical and distance.

  async findProvidersGlobalNear(
    postalCode: string,
    date: Date,
    radiusKm = SEARCH_RADIUS_KM,
    verticalSlug?: string,
  ): Promise<ProviderWithSlot[]> {
    this.logger.log(`[findProvidersGlobalNear] postalCode="${postalCode}" verticalSlug="${verticalSlug}" date="${date.toISOString()}"`);

    const { lat, lng } = await this.geocodePostalCode(postalCode);
    this.logger.log(`[findProvidersGlobalNear] geocoded to lat=${lat} lng=${lng}`);

    // Search from now (or start of requested date) up to 7 days ahead so the
    // AI finds the next available slot even if nothing is open today.
    const slotFrom = date > new Date() ? date : new Date();
    const slotTo = new Date(slotFrom);
    slotTo.setDate(slotTo.getDate() + 7);
    this.logger.log(`[findProvidersGlobalNear] slot window: ${slotFrom.toISOString()} → ${slotTo.toISOString()}`);

    let verticalId: string | null = null;
    if (verticalSlug) {
      const canonical = normalizeVerticalSlug(verticalSlug)!;
      const vertical = await this.prisma.vertical.findUnique({
        where: { slug: canonical },
        select: { id: true },
      });
      if (!vertical) {
        this.logger.warn(
          `Unknown vertical slug "${verticalSlug}" (normalized: "${canonical}") — returning no providers`,
        );
        return [];
      }
      verticalId = vertical.id;
    }

    const providers = verticalId
      ? await this.prisma.$queryRaw<Array<{ id: string; distance_km: number }>>`
          SELECT
            id,
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) AS distance_km
          FROM "Provider"
          WHERE
            "isDeleted" = false
            AND "isActive" = true
            AND "isSetupComplete" = true
            AND "verticalId" = ${verticalId}
          HAVING
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) <= ${radiusKm}
          ORDER BY distance_km ASC
          LIMIT 10
        `
      : await this.prisma.$queryRaw<Array<{ id: string; distance_km: number }>>`
          SELECT
            id,
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) AS distance_km
          FROM "Provider"
          WHERE
            "isDeleted" = false
            AND "isActive" = true
            AND "isSetupComplete" = true
          HAVING
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) <= ${radiusKm}
          ORDER BY distance_km ASC
          LIMIT 10
        `;

    this.logger.log(`[findProvidersGlobalNear] Haversine SQL returned ${providers.length} provider(s): ${providers.map(p => `${p.id}(${Number(p.distance_km).toFixed(2)}km)`).join(', ')}`);

    const results: ProviderWithSlot[] = [];

    for (const row of providers) {
      // Raw provider lookup — bypass mode means no tenant filter; id is a UUID (globally unique).
      const provider = await this.prisma.$queryRaw<Provider[]>`
        SELECT * FROM "Provider" WHERE id = ${row.id} LIMIT 1
      `.then((rows) => rows[0] ?? null);
      if (!provider) {
        this.logger.warn(`[findProvidersGlobalNear] provider ${row.id} not found after SQL`);
        continue;
      }

      // Slot lookup — bypass mode, filter by providerId + status + time range.
      const slot = await this.prisma.$queryRaw<Slot[]>`
        SELECT * FROM "Slot"
        WHERE "providerId" = ${provider.id}
          AND status = 'AVAILABLE'
          AND "startsAt" >= ${slotFrom}
          AND "startsAt" <= ${slotTo}
        ORDER BY "startsAt" ASC
        LIMIT 1
      `.then((rows) => rows[0] ?? null);

      if (!slot) {
        this.logger.warn(`[findProvidersGlobalNear] no AVAILABLE slot for provider ${provider.name} in window ${slotFrom.toISOString()} → ${slotTo.toISOString()}`);
        continue;
      }

      this.logger.log(`[findProvidersGlobalNear] matched: ${provider.name} — slot ${slot.id} at ${new Date(slot.startsAt).toISOString()}`);
      results.push({ provider, slot, distanceKm: Number(row.distance_km) });
    }

    this.logger.log(`[findProvidersGlobalNear] returning ${results.length} result(s)`);
    return results;
  }

  // ─── Per-tenant provider proximity search (kept for backwards compat) ─────

  async findProvidersNear(
    postalCode: string,
    tenantId: string,
    date: Date,
    radiusKm = SEARCH_RADIUS_KM,
    verticalSlug?: string,
  ): Promise<ProviderWithSlot[]> {
    const { lat, lng } = await this.geocodePostalCode(postalCode);

    // Start and end of the requested date (UTC-aware)
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Resolve vertical slug → id so the SQL filter can use the indexed FK.
    // Normalize shorthand first (vet → veterinary, dentist → dental, …) so an
    // AI agent saying "vet" still matches. Unknown slugs return no providers
    // (safer than silently ignoring the filter).
    let verticalId: string | null = null;
    if (verticalSlug) {
      const canonical = normalizeVerticalSlug(verticalSlug)!;
      const vertical = await this.prisma.vertical.findUnique({
        where: { slug: canonical },
        select: { id: true },
      });
      if (!vertical) {
        this.logger.warn(
          `Unknown vertical slug "${verticalSlug}" (normalized to "${canonical}") — returning no providers`,
        );
        return [];
      }
      verticalId = vertical.id;
    }

    // Haversine distance formula in raw SQL — must run inside the DB for performance.
    // Tagged-template params are parameterized by Prisma; safe against SQL injection.
    const providers = verticalId
      ? await this.prisma.$queryRaw<Array<{ id: string; distance_km: number }>>`
          SELECT
            id,
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) AS distance_km
          FROM "Provider"
          WHERE
            "tenantId" = ${tenantId}
            AND "isDeleted" = false
            AND "isActive" = true
            AND "verticalId" = ${verticalId}
          HAVING
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) <= ${radiusKm}
          ORDER BY distance_km ASC
          LIMIT 10
        `
      : await this.prisma.$queryRaw<Array<{ id: string; distance_km: number }>>`
          SELECT
            id,
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) AS distance_km
          FROM "Provider"
          WHERE
            "tenantId" = ${tenantId}
            AND "isDeleted" = false
            AND "isActive" = true
          HAVING
            (6371 * acos(
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )) <= ${radiusKm}
          ORDER BY distance_km ASC
          LIMIT 10
        `;

    const results: ProviderWithSlot[] = [];

    for (const row of providers) {
      const provider = await this.prisma.provider.findFirst({
        where: { id: row.id },
      });
      if (!provider) continue;

      const slot = await this.prisma.slot.findFirst({
        where: {
          providerId: provider.id,
          status: 'AVAILABLE',
          startsAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { startsAt: 'asc' },
      });

      if (!slot) continue; // Skip providers with no available slots that day

      results.push({
        provider,
        slot,
        distanceKm: Number(row.distance_km),
      });
    }

    return results;
  }
}
