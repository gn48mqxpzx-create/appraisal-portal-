import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function resolveUserIdByEmail(email: string | null | undefined): Promise<string | null> {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return null;
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive"
      }
    },
    select: {
      id: true
    }
  });

  return user?.id ?? null;
}