import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserStatus } from '../src/generated/prisma/client';
import { normalizeRwandanPhone, isRwandanPhone } from '../src/common/utils/phone';
import { PasswordHasher } from '../src/modules/auth/services/password-hasher.service';
import { RoleCode } from '../src/modules/roles/rbac.constants';
import { seedCrops } from './seed-crops';
import { seedKnowledgeTopics } from './seed-knowledge';
import { seedNotifications } from './seed-notifications';
import { seedRbac } from './seed-rbac';
import { seedTelephony } from './seed-telephony';

/**
 * Seeds roles, permissions, the initial crops, knowledge topics and notification templates, then the initial administrator when
 * SEED_ADMIN_PASSWORD is set. Safe to run repeatedly; it never deletes data
 * and never overwrites an existing administrator's password.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
  });

  try {
    await seedRbac(prisma);
    console.log('Seeded roles and permissions');
    await seedCrops(prisma);
    console.log('Seeded crops');
    await seedKnowledgeTopics(prisma);
    console.log('Seeded knowledge topics');
    await seedNotifications(prisma);
    console.log('Seeded notification categories, channels and templates');
    await seedTelephony(prisma);
    console.log('Seeded telephony channel settings (USSD and IVR disabled)');

    const password = process.env.SEED_ADMIN_PASSWORD?.trim();
    if (!password) {
      console.log('SEED_ADMIN_PASSWORD is empty: skipping the initial administrator');
      return;
    }

    const phoneNumber = normalizeRwandanPhone(process.env.SEED_ADMIN_PHONE ?? '');
    if (!isRwandanPhone(phoneNumber)) {
      throw new Error('SEED_ADMIN_PHONE must be a valid Rwandan mobile number');
    }
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || null;

    const existing = await prisma.user.findUnique({ where: { phoneNumber } });
    if (existing) {
      console.log(`Administrator ${phoneNumber} already exists: left unchanged`);
      return;
    }

    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.Admin } });
    await prisma.user.create({
      data: {
        fullName: process.env.SEED_ADMIN_FULL_NAME?.trim() || 'MenyaMuhinzi Administrator',
        phoneNumber,
        email,
        passwordHash: await new PasswordHasher().hash(password),
        passwordChangedAt: new Date(),
        status: UserStatus.ACTIVE,
        statusChangedAt: new Date(),
        roles: { create: { roleId: adminRole.id } },
      },
    });
    console.log(`Created administrator ${phoneNumber}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
