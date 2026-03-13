// seedIncreaseGuardrails.mjs
// Run: node packages/database/prisma/seedIncreaseGuardrails.mjs

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const defaults = [
  {
    levelName: "Green",
    colorCode: "#22c55e",
    minPercent: 0,
    maxPercent: 15,
    minAmount: 0,
    maxAmount: 15000,
    actionRequired: "Standard Review",
    isActive: true,
    sortOrder: 1,
  },
  {
    levelName: "Yellow",
    colorCode: "#eab308",
    minPercent: 15.01,
    maxPercent: 25,
    minAmount: 15001,
    maxAmount: 30000,
    actionRequired: "Manager Justification Required",
    isActive: true,
    sortOrder: 2,
  },
  {
    levelName: "Red",
    colorCode: "#ef4444",
    minPercent: 25.01,
    maxPercent: null,
    minAmount: 30001,
    maxAmount: null,
    actionRequired: "Executive Override Required",
    isActive: true,
    sortOrder: 3,
  },
];

async function main() {
  const existing = await prisma.increaseGuardrail.count();
  if (existing > 0) {
    console.log(`Skipped: ${existing} guardrail row(s) already exist.`);
    return;
  }

  for (const row of defaults) {
    await prisma.increaseGuardrail.create({ data: row });
  }
  console.log(`Seeded ${defaults.length} default increase guardrails.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
