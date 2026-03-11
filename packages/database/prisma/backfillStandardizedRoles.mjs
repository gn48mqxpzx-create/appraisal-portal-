import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const normalizeRoleName = (value) => value.trim().toLowerCase();

async function main() {
  const [matrixRows, roleMappings, existingRoles] = await Promise.all([
    prisma.marketValueMatrix.findMany({
      select: {
        id: true,
        roleName: true,
        standardizedRoleId: true
      }
    }),
    prisma.roleAlignmentMapping.findMany({
      select: {
        id: true,
        mappedRoleName: true,
        standardizedRoleId: true
      }
    }),
    prisma.standardizedRole.findMany({
      select: {
        id: true,
        roleName: true,
        isActive: true
      }
    })
  ]);

  const normalizedRoles = new Map();
  for (const role of existingRoles) {
    normalizedRoles.set(normalizeRoleName(role.roleName), role);
  }

  const discoveredRoleNames = new Map();
  for (const row of matrixRows) {
    const roleName = row.roleName.trim();
    if (roleName) {
      discoveredRoleNames.set(normalizeRoleName(roleName), roleName);
    }
  }
  for (const mapping of roleMappings) {
    const roleName = mapping.mappedRoleName.trim();
    if (roleName) {
      discoveredRoleNames.set(normalizeRoleName(roleName), roleName);
    }
  }

  for (const [normalizedName, roleName] of discoveredRoleNames.entries()) {
    const existingRole = normalizedRoles.get(normalizedName);
    if (existingRole) {
      if (!existingRole.isActive) {
        const reactivatedRole = await prisma.standardizedRole.update({
          where: { id: existingRole.id },
          data: { isActive: true }
        });
        normalizedRoles.set(normalizedName, reactivatedRole);
      }
      continue;
    }

    const createdRole = await prisma.standardizedRole.create({
      data: {
        roleName,
        isActive: true
      }
    });
    normalizedRoles.set(normalizedName, createdRole);
  }

  let matrixUpdated = 0;
  for (const row of matrixRows) {
    if (row.standardizedRoleId || !row.roleName.trim()) {
      continue;
    }

    const standardizedRole = normalizedRoles.get(normalizeRoleName(row.roleName));
    if (!standardizedRole) {
      continue;
    }

    await prisma.marketValueMatrix.update({
      where: { id: row.id },
      data: { standardizedRoleId: standardizedRole.id }
    });
    matrixUpdated += 1;
  }

  let mappingsUpdated = 0;
  for (const mapping of roleMappings) {
    if (mapping.standardizedRoleId || !mapping.mappedRoleName.trim()) {
      continue;
    }

    const standardizedRole = normalizedRoles.get(normalizeRoleName(mapping.mappedRoleName));
    if (!standardizedRole) {
      continue;
    }

    await prisma.roleAlignmentMapping.update({
      where: { id: mapping.id },
      data: { standardizedRoleId: standardizedRole.id }
    });
    mappingsUpdated += 1;
  }

  const remainingNullCounts = await Promise.all([
    prisma.marketValueMatrix.count({ where: { standardizedRoleId: null } }),
    prisma.roleAlignmentMapping.count({ where: { standardizedRoleId: null } })
  ]);

  console.log(
    [
      `Standardized roles available: ${normalizedRoles.size}`,
      `Market matrix rows backfilled: ${matrixUpdated}`,
      `Role mappings backfilled: ${mappingsUpdated}`,
      `Market matrix rows still null: ${remainingNullCounts[0]}`,
      `Role mappings still null: ${remainingNullCounts[1]}`
    ].join("\n")
  );
}

main()
  .catch((error) => {
    console.error("Failed to backfill standardized roles:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });