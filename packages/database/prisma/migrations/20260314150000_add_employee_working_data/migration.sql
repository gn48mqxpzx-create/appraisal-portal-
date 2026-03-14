-- CreateTable
CREATE TABLE "employee_working_data" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "hubspotContactId" TEXT,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "contactType" TEXT,
    "isActiveForAppraisal" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "tenureMonths" INTEGER,
    "tenureDisplay" TEXT,
    "tenureGroup" TEXT,
    "successManagerName" TEXT,
    "reportingManagerName" TEXT,
    "hubspotRole" TEXT,
    "normalizedRole" TEXT,
    "normalizedRoleStatus" TEXT,
    "standardizedRoleId" TEXT,
    "currentCompensation" DECIMAL(12,2),
    "compensationCurrency" TEXT,
    "marketMatrixMin" DECIMAL(12,2),
    "marketMatrixMax" DECIMAL(12,2),
    "marketMatrixStatus" TEXT,
    "latestWsllAverage" DECIMAL(5,2),
    "wsllStatus" TEXT,
    "wsllReason" TEXT,
    "rmApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "marketPosition" TEXT,
    "appraisalCategory" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_working_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_working_data_staffId_key" ON "employee_working_data"("staffId");
CREATE INDEX "employee_working_data_isActiveForAppraisal_idx" ON "employee_working_data"("isActiveForAppraisal");
CREATE INDEX "employee_working_data_normalizedRole_idx" ON "employee_working_data"("normalizedRole");
CREATE INDEX "employee_working_data_wsllStatus_idx" ON "employee_working_data"("wsllStatus");
CREATE INDEX "employee_working_data_marketMatrixStatus_idx" ON "employee_working_data"("marketMatrixStatus");
