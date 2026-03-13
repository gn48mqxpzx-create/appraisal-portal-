import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALLOWED_CONTACT_TYPES = [
  "Ops Staff - Active",
  "Staff Member - Active",
  "Staff Member - For Reprofile",
  "Staff Member - HR Floating",
  "Staff Member - Maternity"
];

const randomWsll = () => {
  const min = 2.0;
  const max = 4.0;
  return (Math.random() * (max - min) + min).toFixed(2);
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

async function main() {
  const employees = await prisma.employeeDirectory.findMany({
    where: {
      staffId: { not: "" },
      fullName: { not: "" },
      contactType: { in: ALLOWED_CONTACT_TYPES }
    },
    select: {
      staffId: true,
      fullName: true
    },
    orderBy: [{ fullName: "asc" }]
  });

  const uniqueEmployees = new Map();
  for (const employee of employees) {
    if (!employee.staffId) {
      continue;
    }

    if (!uniqueEmployees.has(employee.staffId)) {
      uniqueEmployees.set(employee.staffId, employee);
    }
  }

  const header = ["Staff ID", "Full Name", "Q1 WSLL", "Q2 WSLL", "Q3 WSLL", "Q4 WSLL"];

  const rows = [...uniqueEmployees.values()].map((employee) => [
    employee.staffId,
    employee.fullName,
    randomWsll(),
    randomWsll(),
    randomWsll(),
    randomWsll()
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const outputPath = path.resolve(process.cwd(), "wsll_full_dummy_upload.csv");
  await fs.writeFile(outputPath, `${csv}\n`, "utf-8");

  console.log(`Generated ${rows.length} rows at ${outputPath}`);
}

main()
  .catch((error) => {
    console.error("Failed to generate wsll_full_dummy_upload.csv", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
