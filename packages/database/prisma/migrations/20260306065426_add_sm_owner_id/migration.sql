-- AlterTable
ALTER TABLE "employee_directory" ADD COLUMN     "smOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "employee_directory_staffId_idx" ON "employee_directory"("staffId");

-- CreateIndex
CREATE INDEX "employee_directory_smOwnerId_idx" ON "employee_directory"("smOwnerId");
