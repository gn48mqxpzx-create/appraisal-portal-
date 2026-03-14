-- CreateEnum
CREATE TYPE "CanonicalHierarchyRole" AS ENUM ('SITE_LEAD', 'SUCCESS_MANAGER', 'RELATIONSHIP_MANAGER', 'REVIEWER', 'UNSCOPED');

-- CreateEnum
CREATE TYPE "HierarchyScopeType" AS ENUM ('DIRECT', 'HYBRID', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "HierarchyMappingSource" AS ENUM ('DIRECTORY_DERIVED', 'ADMIN_OVERRIDE');

-- CreateTable
CREATE TABLE "user_scope_mappings" (
  "id" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "userName" TEXT,
  "canonicalRole" "CanonicalHierarchyRole" NOT NULL,
  "managerEmail" TEXT,
  "managerName" TEXT,
  "staffId" TEXT,
  "mappedSmEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "mappedSmNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "mappedRmEmail" TEXT,
  "mappedRmName" TEXT,
  "scopedStaffIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "scopeType" "HierarchyScopeType" NOT NULL DEFAULT 'DIRECT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "source" "HierarchyMappingSource" NOT NULL DEFAULT 'DIRECTORY_DERIVED',
  "unresolvedHierarchyReason" TEXT,
  "diagnostics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_scope_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_scope_mappings_userEmail_key" ON "user_scope_mappings"("userEmail");

-- CreateIndex
CREATE INDEX "user_scope_mappings_canonicalRole_isActive_idx" ON "user_scope_mappings"("canonicalRole", "isActive");

-- CreateIndex
CREATE INDEX "user_scope_mappings_updatedAt_idx" ON "user_scope_mappings"("updatedAt");
