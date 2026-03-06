-- CreateTable "employee_directory"
CREATE TABLE "employee_directory" (
    "id" TEXT NOT NULL,
    "hubspotContactId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "staffRole" TEXT NOT NULL,
    "smName" TEXT,
    "rmName" TEXT,
    "staffStartDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_directory_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "employee_directory_hubspotContactId_key" ON "employee_directory"("hubspotContactId");
CREATE UNIQUE INDEX "employee_directory_staffId_key" ON "employee_directory"("staffId");
CREATE INDEX "employee_directory_email_idx" ON "employee_directory"("email");
CREATE INDEX "employee_directory_contactType_idx" ON "employee_directory"("contactType");
CREATE INDEX "employee_directory_staffRole_idx" ON "employee_directory"("staffRole");
CREATE INDEX "employee_directory_smName_idx" ON "employee_directory"("smName");
CREATE INDEX "employee_directory_rmName_idx" ON "employee_directory"("rmName");
