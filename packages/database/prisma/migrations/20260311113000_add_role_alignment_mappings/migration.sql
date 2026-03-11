CREATE TYPE "RoleMatchSource" AS ENUM ('AUTO', 'ADMIN_CONFIRMED');

CREATE TABLE "role_alignment_mappings" (
    "id"             TEXT              NOT NULL,
    "sourceRoleName" TEXT              NOT NULL,
    "mappedRoleName" TEXT              NOT NULL,
    "matchSource"    "RoleMatchSource" NOT NULL DEFAULT 'ADMIN_CONFIRMED',
    "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "role_alignment_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_alignment_mappings_sourceRoleName_key"
    ON "role_alignment_mappings"("sourceRoleName");

CREATE INDEX "role_alignment_mappings_mappedRoleName_idx"
    ON "role_alignment_mappings"("mappedRoleName");
