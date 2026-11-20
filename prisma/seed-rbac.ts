import type { PrismaClient } from '../src/generated/prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DEFINITIONS,
} from '../src/modules/roles/rbac.constants';

/**
 * Idempotently creates the system roles and permissions and grants each role
 * its default permissions. Existing grants are never removed, so permissions
 * added by administrators survive re-seeding.
 */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { description: PERMISSION_DESCRIPTIONS[code] },
      create: { code, description: PERMISSION_DESCRIPTIONS[code] },
    });
  }

  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permissionIds = new Map(permissions.map((p) => [p.code, p.id]));

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: { name: definition.name, description: definition.description, isSystem: true },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });

    if (definition.permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: definition.permissions.map((code) => ({
          roleId: role.id,
          permissionId: permissionIds.get(code) as string,
        })),
        skipDuplicates: true,
      });
    }
  }
}
