import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MATRIX_SEED = [
  {
    roleName: "Administrative Assistant",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 35000 },
      { tenureBand: "T2", minSalary: 40000, maxSalary: 60000 },
      { tenureBand: "T3", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T4", minSalary: 80000, maxSalary: 100000 }
    ]
  },
  {
    roleName: "Executive Assistant",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 35000 },
      { tenureBand: "T2", minSalary: 40000, maxSalary: 60000 },
      { tenureBand: "T3", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T4", minSalary: 80000, maxSalary: 100000 }
    ]
  },
  {
    roleName: "Paraplanner",
    entries: [
      { tenureBand: "T1", minSalary: 35000, maxSalary: 45000 },
      { tenureBand: "T2", minSalary: 50000, maxSalary: 75000 },
      { tenureBand: "T3", minSalary: 60000, maxSalary: 100000 },
      { tenureBand: "T4", minSalary: 100000, maxSalary: 120000 }
    ]
  },
  {
    roleName: "Bookkeeper",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 35000 },
      { tenureBand: "T2", minSalary: 40000, maxSalary: 60000 },
      { tenureBand: "T3", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T4", minSalary: 80000, maxSalary: 100000 }
    ]
  },
  {
    roleName: "Accountant",
    entries: [
      { tenureBand: "T1", minSalary: 40000, maxSalary: 60000 },
      { tenureBand: "T2", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T3", minSalary: 80000, maxSalary: 100000 },
      { tenureBand: "T4", minSalary: 100000, maxSalary: 120000 }
    ]
  },
  {
    roleName: "Digital Marketing Specialist",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 40000 },
      { tenureBand: "T2", minSalary: 40000, maxSalary: 70000 },
      { tenureBand: "T3", minSalary: 70000, maxSalary: 90000 },
      { tenureBand: "T4", minSalary: 90000, maxSalary: 120000 }
    ]
  },
  {
    roleName: "Customer Service Representative",
    entries: [
      { tenureBand: "T1", minSalary: 18000, maxSalary: 25000 },
      { tenureBand: "T2", minSalary: 25000, maxSalary: 30000 },
      { tenureBand: "T3", minSalary: 30000, maxSalary: 40000 },
      { tenureBand: "T4", minSalary: 40000, maxSalary: 60000 }
    ]
  },
  {
    roleName: "Loan Processor",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 32000 },
      { tenureBand: "T2", minSalary: 35000, maxSalary: 45000 },
      { tenureBand: "T3", minSalary: 45000, maxSalary: 60000 },
      { tenureBand: "T4", minSalary: 60000, maxSalary: 80000 }
    ]
  },
  {
    roleName: "Broker Support",
    entries: [
      { tenureBand: "T1", minSalary: 30000, maxSalary: 35000 },
      { tenureBand: "T2", minSalary: 45000, maxSalary: 60000 },
      { tenureBand: "T3", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T4", minSalary: 80000, maxSalary: 100000 }
    ]
  },
  {
    roleName: "Credit Analyst",
    entries: [
      { tenureBand: "T1", minSalary: 40000, maxSalary: 60000 },
      { tenureBand: "T2", minSalary: 60000, maxSalary: 80000 },
      { tenureBand: "T3", minSalary: 80000, maxSalary: 100000 },
      { tenureBand: "T4", minSalary: 100000, maxSalary: 120000 }
    ]
  }
];

async function main() {
  const standardizedRoles = await Promise.all(
    MATRIX_SEED.map((role) =>
      prisma.standardizedRole.upsert({
        where: { roleName: role.roleName },
        create: { roleName: role.roleName, isActive: true },
        update: { isActive: true }
      })
    )
  );

  const standardizedRoleByName = new Map(standardizedRoles.map((role) => [role.roleName, role]));

  const flattenedRows = MATRIX_SEED.flatMap((role) => {
    const standardizedRole = standardizedRoleByName.get(role.roleName);
    if (!standardizedRole) {
      return [];
    }

    return role.entries.map((entry) => ({
      roleName: role.roleName,
      standardizedRoleId: standardizedRole.id,
      tenureBand: entry.tenureBand,
      minSalary: entry.minSalary,
      maxSalary: entry.maxSalary
    }));
  });

  await prisma.$transaction(
    flattenedRows.map((row) =>
      prisma.marketValueMatrix.upsert({
        where: {
          roleName_tenureBand: {
            roleName: row.roleName,
            tenureBand: row.tenureBand
          }
        },
        create: row,
        update: {
          roleName: row.roleName,
          standardizedRoleId: row.standardizedRoleId,
          minSalary: row.minSalary,
          maxSalary: row.maxSalary
        }
      })
    )
  );

  const totalRows = await prisma.marketValueMatrix.count();
  console.log(`Seed complete. Upserted ${flattenedRows.length} rows. Table now contains ${totalRows} total rows.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed market value matrix:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
