-- Add employee type classification for directory records

ALTER TABLE "employee_directory"
    ADD COLUMN "employeeType" TEXT NOT NULL DEFAULT 'VA';

CREATE INDEX "employee_directory_employeeType_idx"
    ON "employee_directory"("employeeType");