/**
 * Seed — full RBAC hierarchy across 3 verticals
 *
 * Accounts created:
 *   SUPER_ADMIN     admin@ringr.ca            / Admin1234!
 *   TENANT_ADMIN    admin@vetconnect.ca        / Admin1234!   (VetConnect)
 *   TENANT_ADMIN    admin@dentalconnect.ca     / Admin1234!   (DentalConnect)
 *   TENANT_ADMIN    admin@autoconnect.ca       / Admin1234!   (AutoConnect)
 *   PROVIDER_OWNER  owner@downtownvet.ca       / Owner1234!   (Downtown Animal Hospital)
 *   PROVIDER_OWNER  owner@citydental.ca        / Owner1234!   (City Dental)
 *   PROVIDER_OWNER  owner@quickauto.ca         / Owner1234!   (Quick Auto)
 *   PROVIDER_STAFF  staff@downtownvet.ca       / Staff1234!
 *
 * Tenant API keys (use in X-API-Key header):
 *   VetConnect    vc-api-key-demo-1234
 *   DentalConnect dc-api-key-demo-5678
 *   AutoConnect   ac-api-key-demo-9012
 *
 * Demo OTP: 123456 (when DEMO_MODE=true)
 */

import { PrismaClient, Role, SlotStatus } from '@prisma/client';
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
          greeting: 'Welcome to VetConnect! I can help you book a vet appointment today.',
          systemPromptHint: 'You are a friendly veterinary booking assistant.',
          extraFieldsSchema: {
            petSpecies: { type: 'string', label: 'Pet species', required: true },
            petBreed: { type: 'string', label: 'Breed', required: false },
            visitReason: { type: 'string', label: 'Reason for visit', required: true },
          },
          portalOptions: {
            showPetDetails: true,
            showVaccineHistory: true,
            showWeightTracking: true,
          },
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
          greeting: 'Welcome to DentalConnect! I can help you book a dental appointment today.',
          systemPromptHint: 'You are a friendly dental booking assistant.',
          extraFieldsSchema: {
            treatmentType: { type: 'string', label: 'Treatment type', required: true },
            isNewPatient: { type: 'boolean', label: 'New patient?', required: true },
            insuranceProvider: { type: 'string', label: 'Insurance provider', required: false },
          },
          portalOptions: {
            showTreatmentHistory: true,
            showXrayRecords: true,
            showInsuranceBilling: true,
          },
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
          greeting: 'Welcome to AutoConnect! I can help you book a vehicle service today.',
          systemPromptHint: 'You are a friendly automotive service booking assistant.',
          extraFieldsSchema: {
            carMake: { type: 'string', label: 'Make', required: true },
            carModel: { type: 'string', label: 'Model', required: true },
            carYear: { type: 'number', label: 'Year', required: true },
            serviceType: { type: 'string', label: 'Service type', required: true },
          },
          portalOptions: {
            showVehicleHistory: true,
            showPartsInventory: true,
            showEstimateBuilder: true,
          },
        },
      },
    }),
  ]);

  const [vetVertical, dentalVertical, autoVertical] = verticals;
  console.log('✅  3 verticals (veterinary, dental, automotive)');

  // ─── 2. Tenants ──────────────────────────────────────────────────────────────

  const [vetTenant, dentalTenant, autoTenant] = await Promise.all([
    prisma.tenant.upsert({
      where: { slug: 'vetconnect' },
      update: {},
      create: {
        name: 'VetConnect',
        slug: 'vetconnect',
        subdomain: 'vetconnect',
        apiKey: 'vc-api-key-demo-1234',
        verticalId: vetVertical.id,
      },
    }),
    prisma.tenant.upsert({
      where: { slug: 'dentalconnect' },
      update: {},
      create: {
        name: 'DentalConnect',
        slug: 'dentalconnect',
        subdomain: 'dentalconnect',
        apiKey: 'dc-api-key-demo-5678',
        verticalId: dentalVertical.id,
      },
    }),
    prisma.tenant.upsert({
      where: { slug: 'autoconnect' },
      update: {},
      create: {
        name: 'AutoConnect',
        slug: 'autoconnect',
        subdomain: 'autoconnect',
        apiKey: 'ac-api-key-demo-9012',
        verticalId: autoVertical.id,
      },
    }),
  ]);

  console.log('✅  3 tenants (VetConnect, DentalConnect, AutoConnect)');

  // ─── 3. Retell agents (one per tenant for demo) ───────────────────────────────

  await Promise.all([
    prisma.retellAgent.upsert({
      where: { agentId: 'agent-demo-vet' },
      update: {},
      create: { agentId: 'agent-demo-vet', tenantId: vetTenant.id },
    }),
    prisma.retellAgent.upsert({
      where: { agentId: 'agent-demo-dental' },
      update: {},
      create: { agentId: 'agent-demo-dental', tenantId: dentalTenant.id },
    }),
    prisma.retellAgent.upsert({
      where: { agentId: 'agent-demo-auto' },
      update: {},
      create: { agentId: 'agent-demo-auto', tenantId: autoTenant.id },
    }),
  ]);

  console.log('✅  Retell agents mapped');

  // ─── 4. Providers ─────────────────────────────────────────────────────────────

  // VetConnect providers
  const vetProviders = await Promise.all([
    upsertProvider({
      id: 'prov-vet-1',
      tenantId: vetTenant.id,
      name: 'Downtown Animal Hospital',
      address: '123 King St W',
      city: 'Toronto',
      postalCode: 'M5H 1J9',
      lat: 43.6487, lng: -79.3833,
      phone: '+14165550101',
      email: 'info@downtownvet.ca',
      bio: 'Full-service veterinary hospital in the heart of downtown Toronto.',
    }),
    upsertProvider({
      id: 'prov-vet-2',
      tenantId: vetTenant.id,
      name: 'Midtown Pet Clinic',
      address: '456 Yonge St',
      city: 'Toronto',
      postalCode: 'M4Y 1X5',
      lat: 43.6677, lng: -79.3856,
      phone: '+14165550102',
      email: 'info@midtownpet.ca',
      bio: 'Caring for Toronto pets since 1995.',
    }),
    upsertProvider({
      id: 'prov-vet-3',
      tenantId: vetTenant.id,
      name: 'East End Veterinary',
      address: '789 Queen St E',
      city: 'Toronto',
      postalCode: 'M4M 1H4',
      lat: 43.6603, lng: -79.3426,
      phone: '+14165550103',
      email: 'info@eastendvet.ca',
      bio: 'Your neighbourhood vet in the Beaches area.',
    }),
  ]);

  // DentalConnect providers
  const dentalProviders = await Promise.all([
    upsertProvider({
      id: 'prov-dental-1',
      tenantId: dentalTenant.id,
      name: 'City Dental',
      address: '200 Bay St',
      city: 'Toronto',
      postalCode: 'M5J 2W4',
      lat: 43.6475, lng: -79.3812,
      phone: '+14165550201',
      email: 'info@citydental.ca',
      bio: 'Modern dental care in the financial district.',
    }),
    upsertProvider({
      id: 'prov-dental-2',
      tenantId: dentalTenant.id,
      name: 'Smile Studio',
      address: '1 Bloor St E',
      city: 'Toronto',
      postalCode: 'M4W 1A8',
      lat: 43.6709, lng: -79.3858,
      phone: '+14165550202',
      email: 'info@smilestudio.ca',
      bio: 'Cosmetic and general dentistry at Yonge and Bloor.',
    }),
  ]);

  // AutoConnect providers
  const autoProviders = await Promise.all([
    upsertProvider({
      id: 'prov-auto-1',
      tenantId: autoTenant.id,
      name: 'Quick Auto Service',
      address: '50 Dufferin St',
      city: 'Toronto',
      postalCode: 'M6K 2A3',
      lat: 43.6394, lng: -79.4218,
      phone: '+14165550301',
      email: 'info@quickauto.ca',
      bio: 'Oil changes, brakes, and full-service auto repair.',
    }),
  ]);

  console.log(`✅  ${vetProviders.length + dentalProviders.length + autoProviders.length} providers across 3 verticals`);

  // ─── 5. Schedules (Mon–Fri 9am–5pm) ──────────────────────────────────────────

  const allProviders = [...vetProviders, ...dentalProviders, ...autoProviders];
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

  // ─── 6. Slots — next 14 weekdays for all providers ────────────────────────────

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
          // Skip duplicate
        }
      }
    }
  }

  console.log(`✅  ${slotsCreated} slots generated (14 weekdays × ${slotTimes.length} per provider)`);

  // ─── 7. Staff accounts — full RBAC hierarchy ──────────────────────────────────

  // SUPER_ADMIN (no provider scope — platform-level)
  await upsertStaff({
    id: 'staff-super-admin',
    tenantId: vetTenant.id,      // must belong to a tenant for FK, but role overrides access
    providerId: vetProviders[0].id,
    email: 'admin@ringr.ca',
    password: 'Admin1234!',
    firstName: 'Platform',
    lastName: 'Admin',
    role: Role.SUPER_ADMIN,
  });

  // TENANT_ADMINs
  await upsertStaff({
    id: 'staff-vet-admin',
    tenantId: vetTenant.id,
    providerId: vetProviders[0].id,
    email: 'admin@vetconnect.ca',
    password: 'Admin1234!',
    firstName: 'VetConnect',
    lastName: 'Admin',
    role: Role.TENANT_ADMIN,
  });

  await upsertStaff({
    id: 'staff-dental-admin',
    tenantId: dentalTenant.id,
    providerId: dentalProviders[0].id,
    email: 'admin@dentalconnect.ca',
    password: 'Admin1234!',
    firstName: 'DentalConnect',
    lastName: 'Admin',
    role: Role.TENANT_ADMIN,
  });

  await upsertStaff({
    id: 'staff-auto-admin',
    tenantId: autoTenant.id,
    providerId: autoProviders[0].id,
    email: 'admin@autoconnect.ca',
    password: 'Admin1234!',
    firstName: 'AutoConnect',
    lastName: 'Admin',
    role: Role.TENANT_ADMIN,
  });

  // PROVIDER_OWNERs
  await upsertStaff({
    id: 'staff-vet-owner',
    tenantId: vetTenant.id,
    providerId: vetProviders[0].id,
    email: 'owner@downtownvet.ca',
    password: 'Owner1234!',
    firstName: 'Sarah',
    lastName: 'Chen',
    role: Role.PROVIDER_OWNER,
  });

  await upsertStaff({
    id: 'staff-dental-owner',
    tenantId: dentalTenant.id,
    providerId: dentalProviders[0].id,
    email: 'owner@citydental.ca',
    password: 'Owner1234!',
    firstName: 'James',
    lastName: 'Park',
    role: Role.PROVIDER_OWNER,
  });

  await upsertStaff({
    id: 'staff-auto-owner',
    tenantId: autoTenant.id,
    providerId: autoProviders[0].id,
    email: 'owner@quickauto.ca',
    password: 'Owner1234!',
    firstName: 'Mike',
    lastName: 'Torres',
    role: Role.PROVIDER_OWNER,
  });

  // PROVIDER_STAFF
  await upsertStaff({
    id: 'staff-vet-staff',
    tenantId: vetTenant.id,
    providerId: vetProviders[0].id,
    email: 'staff@downtownvet.ca',
    password: 'Staff1234!',
    firstName: 'Emily',
    lastName: 'Nguyen',
    role: Role.PROVIDER_STAFF,
  });

  console.log('✅  8 staff accounts (1 SUPER_ADMIN, 3 TENANT_ADMIN, 3 PROVIDER_OWNER, 1 PROVIDER_STAFF)');

  // ─── 8. Demo customers ────────────────────────────────────────────────────────

  const customer = await prisma.customer.upsert({
    where: { id: 'cust-demo-1' },
    update: {},
    create: {
      id: 'cust-demo-1',
      tenantId: vetTenant.id,
      phone: '+14165551234',
      name: 'Alex Johnson',
    },
  });

  await prisma.subject.upsert({
    where: { id: 'subj-demo-1' },
    update: {},
    create: {
      id: 'subj-demo-1',
      tenantId: vetTenant.id,
      customerId: customer.id,
      name: 'Buddy',
      type: 'dog',
      extraFields: { breed: 'Labrador Retriever', age: 3, weight: '32kg' },
    },
  });

  await prisma.subject.upsert({
    where: { id: 'subj-demo-2' },
    update: {},
    create: {
      id: 'subj-demo-2',
      tenantId: vetTenant.id,
      customerId: customer.id,
      name: 'Luna',
      type: 'cat',
      extraFields: { breed: 'Domestic Shorthair', age: 5 },
    },
  });

  const dentalCustomer = await prisma.customer.upsert({
    where: { id: 'cust-demo-2' },
    update: {},
    create: {
      id: 'cust-demo-2',
      tenantId: dentalTenant.id,
      phone: '+14165559876',
      name: 'Maria Garcia',
    },
  });

  console.log('✅  Demo customers + subjects seeded');

  // ─── 9. Summary ───────────────────────────────────────────────────────────────

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    SEED COMPLETE 🎉                         ║
╠══════════════════════════════════════════════════════════════╣
║  SUPER_ADMIN portal login (POST /api/v1/admin/auth/login)   ║
║    Email:    admin@ringr.ca                                 ║
║    Password: Admin1234!                                     ║
╠══════════════════════════════════════════════════════════════╣
║  TENANT_ADMIN logins (POST /api/v1/auth/staff/login)        ║
║    VetConnect:    admin@vetconnect.ca   / Admin1234!        ║
║    DentalConnect: admin@dentalconnect.ca / Admin1234!       ║
║    AutoConnect:   admin@autoconnect.ca  / Admin1234!        ║
╠══════════════════════════════════════════════════════════════╣
║  PROVIDER_OWNER logins                                      ║
║    Vet:    owner@downtownvet.ca / Owner1234!                ║
║    Dental: owner@citydental.ca  / Owner1234!                ║
║    Auto:   owner@quickauto.ca   / Owner1234!                ║
╠══════════════════════════════════════════════════════════════╣
║  PROVIDER_STAFF login                                       ║
║    staff@downtownvet.ca / Staff1234!                        ║
╠══════════════════════════════════════════════════════════════╣
║  Tenant API keys (X-API-Key header)                         ║
║    VetConnect:    vc-api-key-demo-1234                      ║
║    DentalConnect: dc-api-key-demo-5678                      ║
║    AutoConnect:   ac-api-key-demo-9012                      ║
╠══════════════════════════════════════════════════════════════╣
║  Retell agent IDs                                           ║
║    Vet:    agent-demo-vet                                   ║
║    Dental: agent-demo-dental                                ║
║    Auto:   agent-demo-auto                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Demo OTP: 123456  (DEMO_MODE=true)                        ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertProvider(data: {
  id: string;
  tenantId: string;
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
    update: {},
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
