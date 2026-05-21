/**
 * Seed — marketplace model.
 *
 * One Tenant ("Ringr"). One Retell agent. Providers are tagged by vertical
 * (vet / dental / auto) and the AI agent routes callers across all of them.
 *
 * Accounts:
 *   SUPER_ADMIN     admin@ringr.ca           / Admin1234!
 *   PROVIDER_OWNER  owner@downtownvet.ca     / Owner1234!  (Downtown Animal Hospital)
 *   PROVIDER_OWNER  owner@citydental.ca      / Owner1234!  (City Dental)
 *   PROVIDER_OWNER  owner@quickauto.ca       / Owner1234!  (Quick Auto)
 *   PROVIDER_STAFF  staff@downtownvet.ca     / Staff1234!
 *
 * Ringr tenant API key (X-API-Key header for portal calls):
 *   ringr-api-key-demo-0001
 *
 * Retell agent ID (one agent serves all verticals):
 *   ringr-agent-demo
 *
 * Demo OTP: 123456 (when DEMO_MODE=true)
 */

import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function hash(password: string) {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log('🌱  Seeding Ringr database…\n');

  // ─── 1. Verticals ────────────────────────────────────────────────────────────

  const verticals = await Promise.all([
    prisma.vertical.upsert({
      where: { slug: 'veterinary' },
      update: {},
      create: {
        name: 'Veterinary',
        slug: 'veterinary',
        config: {
          providerLabel: 'clinic',
          customerLabel: 'pet owner',
          subjectLabel: 'pet',
          appointmentLabel: 'veterinary appointment',
          systemPromptHint: 'A friendly veterinary booking assistant.',
        },
      },
    }),
    prisma.vertical.upsert({
      where: { slug: 'dental' },
      update: {},
      create: {
        name: 'Dental',
        slug: 'dental',
        config: {
          providerLabel: 'practice',
          customerLabel: 'patient',
          subjectLabel: 'patient',
          appointmentLabel: 'dental appointment',
          systemPromptHint: 'A friendly dental booking assistant.',
        },
      },
    }),
    prisma.vertical.upsert({
      where: { slug: 'automotive' },
      update: {},
      create: {
        name: 'Automotive',
        slug: 'automotive',
        config: {
          providerLabel: 'garage',
          customerLabel: 'driver',
          subjectLabel: 'vehicle',
          appointmentLabel: 'service appointment',
          systemPromptHint: 'A friendly automotive service booking assistant.',
        },
      },
    }),
  ]);

  const [vetVertical, dentalVertical, autoVertical] = verticals;
  console.log('✅  3 verticals (veterinary, dental, automotive)');

  // ─── 2. Tenant — the single "Ringr" marketplace ──────────────────────────────

  const ringr = await prisma.tenant.upsert({
    where: { slug: 'ringr' },
    update: {},
    create: {
      name: 'Ringr',
      slug: 'ringr',
      subdomain: 'ringr',
      apiKey: 'ringr-api-key-demo-0001',
      // Tenant.verticalId is required by current schema; "veterinary" is just
      // the primary vertical. Providers carry their own verticalId so this is
      // effectively decorative in the marketplace model.
      verticalId: vetVertical.id,
    },
  });
  console.log('✅  Tenant "Ringr"');

  // ─── 3. One Retell agent that handles all verticals ──────────────────────────

  await prisma.retellAgent.upsert({
    where: { agentId: 'ringr-agent-demo' },
    update: {},
    create: { agentId: 'ringr-agent-demo', tenantId: ringr.id },
  });
  console.log('✅  Retell agent: ringr-agent-demo');

  // ─── 4. Providers across all 3 verticals, all under Ringr ────────────────────

  const vetProviders = await Promise.all([
    upsertProvider({
      id: 'prov-vet-1',
      tenantId: ringr.id,
      verticalId: vetVertical.id,
      name: 'Downtown Animal Hospital',
      address: '123 King St W', city: 'Toronto', postalCode: 'M5H 1J9',
      lat: 43.6487, lng: -79.3833,
      phone: '+14165550101', email: 'info@downtownvet.ca',
      bio: 'Full-service veterinary hospital in the heart of downtown Toronto.',
    }),
    upsertProvider({
      id: 'prov-vet-2',
      tenantId: ringr.id,
      verticalId: vetVertical.id,
      name: 'Midtown Pet Clinic',
      address: '456 Yonge St', city: 'Toronto', postalCode: 'M4Y 1X5',
      lat: 43.6677, lng: -79.3856,
      phone: '+14165550102', email: 'info@midtownpet.ca',
      bio: 'Caring for Toronto pets since 1995.',
    }),
    upsertProvider({
      id: 'prov-vet-3',
      tenantId: ringr.id,
      verticalId: vetVertical.id,
      name: 'East End Veterinary',
      address: '789 Queen St E', city: 'Toronto', postalCode: 'M4M 1H4',
      lat: 43.6603, lng: -79.3426,
      phone: '+14165550103', email: 'info@eastendvet.ca',
      bio: 'Your neighbourhood vet in the Beaches area.',
    }),
  ]);

  const dentalProviders = await Promise.all([
    upsertProvider({
      id: 'prov-dental-1',
      tenantId: ringr.id,
      verticalId: dentalVertical.id,
      name: 'City Dental',
      address: '200 Bay St', city: 'Toronto', postalCode: 'M5J 2W4',
      lat: 43.6475, lng: -79.3812,
      phone: '+14165550201', email: 'info@citydental.ca',
      bio: 'Modern dental care in the financial district.',
    }),
    upsertProvider({
      id: 'prov-dental-2',
      tenantId: ringr.id,
      verticalId: dentalVertical.id,
      name: 'Smile Studio',
      address: '1 Bloor St E', city: 'Toronto', postalCode: 'M4W 1A8',
      lat: 43.6709, lng: -79.3858,
      phone: '+14165550202', email: 'info@smilestudio.ca',
      bio: 'Cosmetic and general dentistry at Yonge and Bloor.',
    }),
  ]);

  const autoProviders = await Promise.all([
    upsertProvider({
      id: 'prov-auto-1',
      tenantId: ringr.id,
      verticalId: autoVertical.id,
      name: 'Quick Auto Service',
      address: '50 Dufferin St', city: 'Toronto', postalCode: 'M6K 2A3',
      lat: 43.6394, lng: -79.4218,
      phone: '+14165550301', email: 'info@quickauto.ca',
      bio: 'Oil changes, brakes, and full-service auto repair.',
    }),
  ]);

  const allProviders = [...vetProviders, ...dentalProviders, ...autoProviders];
  console.log(`✅  ${allProviders.length} providers across 3 verticals`);

  // ─── 5. Schedules (Mon–Fri 9am–5pm) ──────────────────────────────────────────

  for (const provider of allProviders) {
    for (const dow of [1, 2, 3, 4, 5]) {
      await prisma.providerSchedule.upsert({
        where: { id: `sched-${provider.id}-${dow}` },
        update: {},
        create: {
          id: `sched-${provider.id}-${dow}`,
          tenantId: provider.tenantId,
          providerId: provider.id,
          dayOfWeek: dow,
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
        },
      });
    }
  }
  console.log('✅  Schedules set (Mon–Fri 9am–5pm, 30-min slots)');

  // ─── 6. Slots — next 14 weekdays ─────────────────────────────────────────────

  let slotsCreated = 0;
  const now = new Date();
  const slotTimes = [
    '09:00','09:30','10:00','10:30','11:00','11:30',
    '12:00','12:30','13:00','13:30','14:00','14:30',
    '15:00','15:30','16:00','16:30',
  ];

  for (const provider of allProviders) {
    let daysGenerated = 0;
    let offset = 0;
    while (daysGenerated < 14) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset++);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      daysGenerated++;

      for (const time of slotTimes) {
        const [h, m] = time.split(':').map(Number);
        const startsAt = new Date(date);
        startsAt.setHours(h, m, 0, 0);
        const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

        try {
          await prisma.slot.create({
            data: { tenantId: provider.tenantId, providerId: provider.id, startsAt, endsAt },
          });
          slotsCreated++;
        } catch {
          // Skip duplicate (slot already exists from previous seed run)
        }
      }
    }
  }
  console.log(`✅  ${slotsCreated} slots generated (14 weekdays × ${slotTimes.length} per provider)`);

  // ─── 7. Staff accounts ───────────────────────────────────────────────────────

  // SUPER_ADMIN — platform-level. Sits on a placeholder provider for FK
  // satisfaction; role overrides scoped access.
  await upsertStaff({
    id: 'staff-super-admin',
    tenantId: ringr.id,
    providerId: vetProviders[0].id,
    email: 'admin@ringr.ca',
    password: 'Admin1234!',
    firstName: 'Platform',
    lastName: 'Admin',
    role: Role.SUPER_ADMIN,
  });

  // PROVIDER_OWNER per example clinic
  await upsertStaff({
    id: 'staff-vet-owner',
    tenantId: ringr.id,
    providerId: vetProviders[0].id,
    email: 'owner@downtownvet.ca',
    password: 'Owner1234!',
    firstName: 'Sarah', lastName: 'Chen',
    role: Role.PROVIDER_OWNER,
  });
  await upsertStaff({
    id: 'staff-dental-owner',
    tenantId: ringr.id,
    providerId: dentalProviders[0].id,
    email: 'owner@citydental.ca',
    password: 'Owner1234!',
    firstName: 'James', lastName: 'Park',
    role: Role.PROVIDER_OWNER,
  });
  await upsertStaff({
    id: 'staff-auto-owner',
    tenantId: ringr.id,
    providerId: autoProviders[0].id,
    email: 'owner@quickauto.ca',
    password: 'Owner1234!',
    firstName: 'Mike', lastName: 'Torres',
    role: Role.PROVIDER_OWNER,
  });

  // PROVIDER_STAFF (receptionist)
  await upsertStaff({
    id: 'staff-vet-staff',
    tenantId: ringr.id,
    providerId: vetProviders[0].id,
    email: 'staff@downtownvet.ca',
    password: 'Staff1234!',
    firstName: 'Emily', lastName: 'Nguyen',
    role: Role.PROVIDER_STAFF,
  });

  console.log('✅  Staff accounts (1 SUPER_ADMIN, 3 PROVIDER_OWNER, 1 PROVIDER_STAFF)');

  // ─── 8. Demo customer + subjects ─────────────────────────────────────────────

  const customer = await prisma.customer.upsert({
    where: { id: 'cust-demo-1' },
    update: {},
    create: {
      id: 'cust-demo-1',
      tenantId: ringr.id,
      phone: '+14165551234',
      name: 'Alex Johnson',
    },
  });

  await prisma.subject.upsert({
    where: { id: 'subj-demo-1' },
    update: {},
    create: {
      id: 'subj-demo-1',
      tenantId: ringr.id,
      customerId: customer.id,
      name: 'Buddy',
      type: 'dog',
      extraFields: { breed: 'Labrador Retriever', age: 3 },
    },
  });

  console.log('✅  Demo customer + subject seeded\n');

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    SEED COMPLETE                             ║
╠══════════════════════════════════════════════════════════════╣
║  SUPER_ADMIN  (POST /api/v1/admin/auth/login)                ║
║    admin@ringr.ca / Admin1234!                               ║
╠══════════════════════════════════════════════════════════════╣
║  PROVIDER_OWNERs  (POST /api/v1/auth/staff/login)            ║
║    owner@downtownvet.ca / Owner1234!                         ║
║    owner@citydental.ca  / Owner1234!                         ║
║    owner@quickauto.ca   / Owner1234!                         ║
╠══════════════════════════════════════════════════════════════╣
║  Ringr tenant API key (X-API-Key header)                     ║
║    ringr-api-key-demo-0001                                   ║
║  Retell agent ID                                             ║
║    ringr-agent-demo                                          ║
║  Demo OTP (DEMO_MODE=true): 123456                           ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertProvider(data: {
  id: string;
  tenantId: string;
  verticalId: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  lat: number;
  lng: number;
  phone: string;
  email: string;
  bio?: string;
}) {
  return prisma.provider.upsert({
    where: { id: data.id },
    update: { verticalId: data.verticalId },
    create: { ...data, province: 'ON' },
  });
}

async function upsertStaff(data: {
  id: string;
  tenantId: string;
  providerId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
}) {
  const { password, ...rest } = data;
  const passwordHash = await hash(password);
  return prisma.providerStaff.upsert({
    where: { id: data.id },
    update: {},
    create: { ...rest, passwordHash },
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
