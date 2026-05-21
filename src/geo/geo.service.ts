import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InjectRedis } from '../redis/redis.decorator';
import type Redis from 'ioredis';
import { Provider, Slot } from '@prisma/client';

const SEARCH_RADIUS_KM = 25;
const GEO_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
// Demo-mode fixed coordinate: Toronto downtown
const DEMO_COORDINATE = { lat: 43.6532, lng: -79.3832 };

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

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      this.logger.warn(`Geocoding failed for ${postalCode}: ${data.status}`);
      return DEMO_COORDINATE; // Graceful fallback
    }

    const { lat, lng } = data.results[0].geometry.location;
    const coords = { lat, lng };

    await this.redis.setex(cacheKey, GEO_CACHE_TTL, JSON.stringify(coords));
    return coords;
  }

  // ─── Provider proximity search ────────────────────────────────────────────

  async findProvidersNear(
    postalCode: string,
    tenantId: string,
    date: Date,
    radiusKm = SEARCH_RADIUS_KM,
  ): Promise<ProviderWithSlot[]> {
    const { lat, lng } = await this.geocodePostalCode(postalCode);

    // Start and end of the requested date (UTC-aware)
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Haversine distance formula in raw SQL — must run inside the DB for performance
    const providers = await this.prisma.$queryRaw<
      Array<{ id: string; distance_km: number }>
    >`
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
