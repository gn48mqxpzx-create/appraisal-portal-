# Database Schema Documentation
## Salary Appraisal Workflow System

### Version: 1.0
### Date: February 26, 2026

---

## Overview

This document provides the complete database schema using Prisma ORM for PostgreSQL. The schema is designed for:
- **Auditability**: Every change is tracked
- **Immutability**: Sealed cycles are permanently read-only
- **Referential Integrity**: Proper foreign key constraints
- **Performance**: Strategic indexing for 700+ cases per cycle

---

## Prisma Schema (schema.prisma)

```prisma
// This is your Prisma schema file
// Learn more: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================================
// AUTHENTICATION & USERS
// ============================================================================

model User {
  id                 String    @id @default(uuid())
  email              String    @unique
  emailDomain        String    // Extracted from email for whitelisting
  isActive           Boolean   @default(true)
  lastLoginAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  
  // Staff identification (optional, links to employee if user is also an employee)
  staffId            String?   @unique
  fullName           String?
  
  // Relations
  roles              UserRole[]
  sessions           Session[]
  otpCodes           OtpCode[]
  auditEvents        AuditEvent[]
  
  // Created/Updated tracking
  cyclesCreated      Cycle[]           @relation("CycleCreatedBy")
  casesUpdated       AppraisalCase[]   @relation("CaseUpdatedBy")
  approvalsCreated   CaseApproval[]    @relation("ApprovalCreatedBy")
  checklistCompleted CaseChecklistItem[] @relation("ChecklistCompletedBy")
  overridesCreated   ManagerOverride[] @relation("OverrideCreatedBy")
  contactTypeMappingsCreated ContactTypeMapping[] @relation("MappingCreatedBy")
  unmappedValuesResolved UnmappedValueEvent[] @relation("UnmappedValueResolver")
  
  @@index([email])
  @@index([staffId])
  @@map("users")
}

model Role {
  id          String   @id @default(uuid())
  name        String   @unique // ADMIN, HR, FINANCE, PAYROLL, MANAGER, SM, RM
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relations
  userRoles   UserRole[]
  permissions FieldGroupPermission[]
  
  @@map("roles")
}

model UserRole {
  id        String   @id @default(uuid())
  userId    String
  roleId    String
  assignedAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
  
  @@unique([userId, roleId])
  @@index([userId])
  @@map("user_roles")
}

model Session {
  id           String   @id @default(uuid())
  userId       String
  accessToken  String   @unique // Hashed JWT
  refreshToken String   @unique // Hashed refresh token
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime @default(now())
  ipAddress    String?
  userAgent    String?
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([accessToken])
  @@index([expiresAt])
  @@map("sessions")
}

model OtpCode {
  id         String   @id @default(uuid())
  email      String
  code       String   // Hashed 6-digit code
  expiresAt  DateTime
  verified   Boolean  @default(false)
  verifiedAt DateTime?
  attempts   Int      @default(0)
  createdAt  DateTime @default(now())
  ipAddress  String?
  
  userId String?
  user   User?  @relation(fields: [userId], references: [id], onDelete: SetNull)
  
  @@index([email, verified, expiresAt])
  @@map("otp_codes")
}

model EmailDomainWhitelist {
  id        String   @id @default(uuid())
  domain    String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@map("email_domain_whitelist")
}

// ============================================================================
// CYCLES
// ============================================================================

model Cycle {
  id              String    @id @default(uuid())
  name            String    // "Annual AU FY 2026", "Anniversary Q1 2026"
  type            CycleType // ANNUAL_AU_FY, ANNIVERSARY
  startDate       DateTime
  isActive        Boolean   @default(false)
  importsLocked   Boolean   @default(false)
  importsLockedAt DateTime?
  importsLockedBy String?
  sealed          Boolean   @default(false)
  sealedAt        DateTime?
  sealedBy        String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  createdBy       String
  
  creator         User                  @relation("CycleCreatedBy", fields: [createdBy], references: [id])
  
  // Relations
  cases           AppraisalCase[]
  uploadBatches   UploadBatch[]
  managerOverrides ManagerOverride[]    @relation("CycleSpecificOverrides")
  computationSnapshots ComputationSnapshot[]
  
  @@index([type, isActive])
  @@index([importsLocked])
  @@index([sealed])
  @@map("cycles")
}

enum CycleType {
  ANNUAL_AU_FY
  ANNIVERSARY
}

// ============================================================================
// APPRAISAL CASES
// ============================================================================

model AppraisalCase {
  id                      String      @id @default(uuid())
  cycleId                 String
  
  // Employee identification
  staffId                 String      // Unique per employee, not per case
  fullName                String
  rawContactType          String      // Raw value from intake (e.g., "Ops Staff - Active") - kept for traceability
  contactType             String      // Mapped/computed value per contact type mapping rules (e.g., "Ops Active")
  companyName             String
  staffRole               String      // Used for market benchmark matching
  startDate               DateTime
  
  // Manager mapping from intake (base value)
  successManagerStaffId   String?
  relationshipManagerStaffId String?
  managerStaffIdFromIntake String?
  
  // Resolved manager (computed via override precedence)
  resolvedManagerStaffId  String?     // Computed field, indexed for manager visibility
  
  // Status and lifecycle
  status                  CaseStatus  @default(DRAFT)
  previousStatus          CaseStatus?
  isRemoved               Boolean     @default(false)
  closeDate               DateTime?
  lockedAt                DateTime?
  lockedBy                String?
  effectivityDate         DateTime?
  effectivityStatus       EffectivityStatus @default(PENDING_EFFECTIVITY)
  
  // Flags
  isMissingBenchmark      Boolean     @default(false)
  hasOverride             Boolean     @default(false)
  hasMissingApprovalEvidence Boolean  @default(false)
  
  // Tenure (computed from startDate, stored for consistency in exports)
  tenureMonths            Int?
  tenureComputedAt        DateTime?
  
  // Timestamps
  createdAt               DateTime    @default(now())
  updatedAt               DateTime    @updatedAt
  updatedBy               String?
  
  cycle Cycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  updater User? @relation("CaseUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)
  
  // Relations
  compensation      CaseCompensation?
  approvals         CaseApproval[]
  checklistItems    CaseChecklistItem[]
  movementLogs      CaseMovementLog[]
  computationSnapshot ComputationSnapshot?
  
  @@unique([cycleId, staffId]) // One case per staff per cycle
  @@index([cycleId, status])
  @@index([staffId])
  @@index([resolvedManagerStaffId])
  @@index([companyName])
  @@index([staffRole])
  @@index([status])
  @@index([isRemoved])
  @@index([isMissingBenchmark])
  @@index([hasOverride])
  @@map("appraisal_cases")
}

enum CaseStatus {
  DRAFT
  IN_REVIEW
  BLOCKED
  APPROVED
  RELEASED_TO_PAYROLL
  REMOVED_FROM_SCOPE
}

enum EffectivityStatus {
  PENDING_EFFECTIVITY
  EFFECTIVE
  HISTORICAL
}

// ============================================================================
// CASE COMPENSATION
// ============================================================================

model CaseCompensation {
  id        String @id @default(uuid())
  caseId    String @unique
  
  // Current compensation (input via web or upload)
  currentBaseSalary       Decimal  @default(0) @db.Decimal(12, 2)
  currentFixedAllowances  Decimal  @default(0) @db.Decimal(12, 2)
  currentVariableAllowances Decimal @default(0) @db.Decimal(12, 2)
  currentRecurringBonuses Decimal  @default(0) @db.Decimal(12, 2)
  currentOnetimeBonuses   Decimal  @default(0) @db.Decimal(12, 2) // Reference only
  currentTotalCompensation Decimal @default(0) @db.Decimal(12, 2) // Computed
  
  // Market benchmark and recommendation (computed, snapshot preserved)
  benchmarkUsed           Decimal? @db.Decimal(12, 2)
  catchupPercentUsed      Int?     // 1-100
  tenureMonthsUsed        Int?
  tenureComputedAt        DateTime?
  varianceAmount          Decimal? @db.Decimal(12, 2)
  variancePercent         Decimal? @db.Decimal(10, 4)
  recommendedIncreaseAmount Decimal @default(0) @db.Decimal(12, 2)
  recommendedNewBase      Decimal @default(0) @db.Decimal(12, 2)
  recommendedAdjustmentPercent Decimal? @db.Decimal(10, 4)
  
  // Override
  isOverride              Boolean  @default(false)
  overrideReason          String?
  overrideApprovedBy      String?
  overrideApprovedAt      DateTime?
  
  // Approved compensation (final values for payroll)
  approvedNewBaseSalary   Decimal? @db.Decimal(12, 2)
  approvedFixedAllowances Decimal? @db.Decimal(12, 2)
  approvedVariableAllowances Decimal? @db.Decimal(12, 2)
  approvedRecurringBonuses Decimal? @db.Decimal(12, 2)
  approvedTotalCompensation Decimal? @db.Decimal(12, 2) // Computed
  approvedAmountDifference Decimal? @db.Decimal(12, 2)
  approvedPercentDifference Decimal? @db.Decimal(10, 4)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  case AppraisalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  
  @@index([caseId])
  @@map("case_compensation")
}

// ============================================================================
// COMPUTATION SNAPSHOTS
// ============================================================================

model ComputationSnapshot {
  id        String @id @default(uuid())
  cycleId   String
  caseId    String @unique
  
  // Frozen snapshot of recommendation at time of snapshot
  benchmarkUsed           Decimal  @db.Decimal(12, 2)
  catchupPercentUsed      Int
  tenureMonthsUsed        Int
  varianceAmount          Decimal  @db.Decimal(12, 2)
  variancePercent         Decimal? @db.Decimal(10, 4)
  recommendedIncreaseAmount Decimal @db.Decimal(12, 2)
  recommendedNewBase      Decimal  @db.Decimal(12, 2)
  recommendedAdjustmentPercent Decimal? @db.Decimal(10, 4)
  
  createdAt DateTime @default(now())
  
  cycle Cycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  case  AppraisalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  
  @@index([cycleId])
  @@index([caseId])
  @@map("computation_snapshots")
}

// ============================================================================
// APPROVALS & EVIDENCE
// ============================================================================

model CaseApproval {
  id            String   @id @default(uuid())
  caseId        String
  
  approvalType  String   @default("EMAIL") // EMAIL, MEETING, VERBAL, etc.
  status        ApprovalStatus @default(PENDING)
  approvalDate  DateTime?
  approvedByName String?
  notes         String?
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdBy     String
  
  case    AppraisalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  creator User          @relation("ApprovalCreatedBy", fields: [createdBy], references: [id])
  
  // Relations
  attachments ApprovalAttachment[]
  
  @@index([caseId])
  @@index([status])
  @@map("case_approvals")
}

enum ApprovalStatus {
  PENDING
  RECEIVED
  VERIFIED
}

model ApprovalAttachment {
  id         String   @id @default(uuid())
  approvalId String
  
  attachmentType AttachmentType // UPLOAD or DRIVE_LINK
  
  // For UPLOAD type
  storageKey     String?  // S3 key or local path
  fileName       String?
  fileSize       Int?
  mimeType       String?
  checksum       String?
  
  // For DRIVE_LINK type
  driveUrl       String?
  
  createdAt DateTime @default(now())
  
  approval CaseApproval @relation(fields: [approvalId], references: [id], onDelete: Cascade)
  
  @@index([approvalId])
  @@map("approval_attachments")
}

enum AttachmentType {
  UPLOAD
  DRIVE_LINK
}

// ============================================================================
// CHECKLIST
// ============================================================================

model CaseChecklistItem {
  id          String   @id @default(uuid())
  caseId      String
  
  itemKey     String   // HR_REVIEW, MANAGER_REVIEW, FINANCE_APPROVAL, etc.
  assignedRole String  // ADMIN, HR, FINANCE, PAYROLL, MANAGER
  
  completed   Boolean  @default(false)
  completedBy String?
  completedAt DateTime?
  
  createdAt   DateTime @default(now())
  
  case      AppraisalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  completer User?         @relation("ChecklistCompletedBy", fields: [completedBy], references: [id], onDelete: SetNull)
  
  @@unique([caseId, itemKey])
  @@index([caseId])
  @@index([assignedRole, completed])
  @@map("case_checklist_items")
}

// ============================================================================
// MOVEMENT LOGS
// ============================================================================

model CaseMovementLog {
  id        String   @id @default(uuid())
  caseId    String
  
  movementType MovementType
  fieldName    String?  // For FIELD_CHANGE: "manager_staff_id", "company_name", etc.
  oldValue     String?
  newValue     String?
  
  timestamp DateTime @default(now())
  
  case AppraisalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  
  @@index([caseId, timestamp])
  @@map("case_movement_logs")
}

enum MovementType {
  ADDED
  REMOVED
  RE_ADDED
  FIELD_CHANGE
}

// ============================================================================
// UPLOADS
// ============================================================================

model UploadBatch {
  id                String   @id @default(uuid())
  cycleId           String
  uploadType        UploadType
  
  fileName          String
  uploadedBy        String
  uploadedAt        DateTime @default(now())
  
  totalRows         Int
  importedCount     Int      @default(0)
  flaggedCount      Int      @default(0)
  errorCount        Int      @default(0)
  
  // Movement counts (intake uploads only)
  addedCount        Int?
  removedCount      Int?
  readdedCount      Int?
  updatedCount      Int?
  
  processingStatus  ProcessingStatus @default(PENDING)
  processedAt       DateTime?
  errorMessage      String?
  
  cycle Cycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  
  // Relations
  rowResults UploadRowResult[]
  
  @@index([cycleId, uploadType])
  @@index([uploadedAt])
  @@map("upload_batches")
}

enum UploadType {
  INTAKE
  COMPENSATION
}

enum ProcessingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model UploadRowResult {
  id        String   @id @default(uuid())
  batchId   String
  
  rowNumber Int
  status    RowStatus
  flags     String[] // Array of flag codes: DUPLICATE_STAFF_ID, MISSING_NAME, UNMAPPED_CONTACT_TYPE, etc.
  errorMessage String?
  rawData   Json     // Store original row data for reporting (enables questionable-data export)
  
  createdAt DateTime @default(now())
  
  batch UploadBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  
  @@index([batchId, status])
  @@map("upload_row_results")
}

enum RowStatus {
  IMPORTED
  FLAGGED
  ERROR
}

// ============================================================================
// CONTACT TYPE MAPPINGS (Dynamic mapping management)
// ============================================================================

model ContactTypeMapping {
  id           String   @id @default(uuid())
  rawValue     String   @unique  // e.g., "Ops Staff - Active"
  mappedValue  String             // e.g., "Ops Active" (one of the standard outputs)
  status       MappingStatus @default(ACTIVE) // ACTIVE, DISABLED
  
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  creator User @relation("MappingCreatedBy", fields: [createdBy], references: [id], onDelete: Restrict)
  
  @@index([rawValue])
  @@index([status])
  @@map("contact_type_mappings")
}

enum MappingStatus {
  ACTIVE
  DISABLED
}

model UnmappedValueEvent {
  id                  String   @id @default(uuid())
  fieldName           String   // e.g., "contact_type"
  rawValue            String
  
  firstSeenUploadId   String
  lastSeenUploadId    String
  occurrencesCount    Int      @default(1)
  
  status              UnmappedStatus @default(OPEN) // OPEN, RESOLVED, IGNORED
  resolvedBy          String?
  resolvedAt          DateTime?
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  
  resolver User? @relation("UnmappedValueResolver", fields: [resolvedBy], references: [id], onDelete: SetNull)
  
  @@unique([fieldName, rawValue])
  @@index([status])
  @@index([fieldName, rawValue])
  @@map("unmapped_value_events")
}

enum UnmappedStatus {
  OPEN
  RESOLVED
  IGNORED
}

// ============================================================================
// MARKET RULES ENGINE
// ============================================================================

model TenureBand {
  id          String   @id @default(uuid())
  name        String   @unique // "0-6 months", "6-12 months", "1-2 years", etc.
  minMonths   Int
  maxMonths   Int
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relations
  benchmarks MarketBenchmark[]
  
  @@index([minMonths, maxMonths])
  @@map("tenure_bands")
}

model MarketBenchmark {
  id              String   @id @default(uuid())
  staffRole       String
  tenureBandId    String
  
  baseSalary      Decimal  @db.Decimal(12, 2)
  catchupPercent  Int?     // 1-100, overrides global default if set
  
  isActive        Boolean  @default(true)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  tenureBand TenureBand @relation(fields: [tenureBandId], references: [id], onDelete: Cascade)
  
  @@unique([staffRole, tenureBandId])
  @@index([staffRole])
  @@index([tenureBandId])
  @@map("market_benchmarks")
}

model GlobalSettings {
  id                        String   @id @default(uuid())
  key                       String   @unique
  value                     String
  description               String?
  
  updatedAt                 DateTime @updatedAt
  
  @@map("global_settings")
}

// Key entries:
// - DEFAULT_CATCHUP_PERCENT: "75"
// - ALLOWED_EMAIL_DOMAINS: "company.com,partner.com"

// ============================================================================
// MANAGER OVERRIDES
// ============================================================================

model ManagerOverride {
  id                  String   @id @default(uuid())
  employeeStaffId     String
  managerStaffId      String
  
  scope               OverrideScope
  cycleId             String?  // Required if scope = CYCLE
  
  previousManagerStaffId String? // For audit trail
  
  createdAt           DateTime @default(now())
  createdBy           String
  
  cycle   Cycle? @relation("CycleSpecificOverrides", fields: [cycleId], references: [id], onDelete: Cascade)
  creator User   @relation("OverrideCreatedBy", fields: [createdBy], references: [id])
  
  @@unique([employeeStaffId, scope, cycleId]) // Prevent duplicate overrides
  @@index([employeeStaffId])
  @@index([scope, cycleId])
  @@map("manager_overrides")
}

enum OverrideScope {
  GLOBAL
  CYCLE
}

// ============================================================================
// PERMISSIONS
// ============================================================================

model FieldGroup {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  fields      String[] // Array of field keys: ["current_base_salary", "current_fixed_allowances"]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relations
  permissions FieldGroupPermission[]
  
  @@map("field_groups")
}

model FieldGroupPermission {
  id           String   @id @default(uuid())
  fieldGroupId String
  roleId       String
  
  canView      Boolean  @default(false)
  canEdit      Boolean  @default(false)
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  fieldGroup FieldGroup @relation(fields: [fieldGroupId], references: [id], onDelete: Cascade)
  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  
  @@unique([fieldGroupId, roleId])
  @@index([roleId])
  @@map("field_group_permissions")
}

// ============================================================================
// AUDIT EVENTS
// ============================================================================

model AuditEvent {
  id          String   @id @default(uuid())
  entityType  String   // CYCLE, CASE, APPROVAL, CHECKLIST, OVERRIDE, etc.
  entityId    String
  action      String   // CREATED, UPDATED, DELETED, STATUS_CHANGED, LOCKED, SEALED, etc.
  
  actorId     String?
  actorEmail  String?
  actorName   String?
  
  before      Json?    // Previous state
  after       Json?    // New state
  changes     Json?    // Diff object
  
  ipAddress   String?
  userAgent   String?
  
  createdAt   DateTime @default(now())
  
  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)
  
  @@index([entityType, entityId, createdAt])
  @@index([actorId])
  @@index([createdAt])
  @@map("audit_events")
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

model NotificationQueue {
  id            String   @id @default(uuid())
  recipientEmail String
  recipientName  String?
  subject       String
  body          String
  
  type          String   // OTP, CHECKLIST_REMINDER, APPROVAL_REQUIRED, etc.
  priority      Int      @default(5) // 1-10, lower = higher priority
  
  status        NotificationStatus @default(PENDING)
  sentAt        DateTime?
  failedAt      DateTime?
  errorMessage  String?
  retryCount    Int      @default(0)
  
  createdAt     DateTime @default(now())
  
  @@index([status, priority, createdAt])
  @@map("notification_queue")
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}

```

---

## Schema Design Rationale

### 1. User and Authentication

**OTP Strategy**:
- `OtpCode` table stores hashed codes with expiry
- Track `attempts` to implement lockout after 5 failed attempts
- `verified` flag prevents code reuse
- `ipAddress` for rate limiting by IP

**Session Management**:
- JWT tokens stored hashed in `Session` table
- Separate `accessToken` (short-lived) and `refreshToken` (long-lived)
- `lastUsedAt` for idle timeout detection
- Cascade delete sessions when user deleted

**Domain Whitelisting**:
- `EmailDomainWhitelist` table for configurable allowed domains
- `User.emailDomain` extracted on signup for fast lookup

### 2. Cycles

**State Flags**:
- `isActive`: Only one active cycle of each type recommended
- `importsLocked`: Prevents further intake uploads
- `sealed`: Permanent read-only state
- Store `*By` user IDs for accountability

**Type Enum**:
- `ANNUAL_AU_FY` vs `ANNIVERSARY` allows different rules per type
- Extensible to add more cycle types later

### 3. Appraisal Cases

**Staff ID Design**:
- `staffId` is the employee identifier (not case ID)
- Unique constraint on `(cycleId, staffId)` ensures one case per employee per cycle
- Allows same employee in multiple cycles

**Manager Resolution**:
- Store `managerStaffIdFromIntake` as base value
- Compute `resolvedManagerStaffId` via override precedence
- Index on `resolvedManagerStaffId` for manager visibility queries

**Status Enum**:
- Linear progression: DRAFT → IN_REVIEW → APPROVED → RELEASED_TO_PAYROLL
- BLOCKED can occur at any stage
- REMOVED_FROM_SCOPE is separate track

**Flags for Filtering**:
- `isMissingBenchmark`: Fast filter for cases needing attention
- `hasOverride`: Fast filter for override reports
- `hasMissingApprovalEvidence`: Fast filter for blockers

**Locking**:
- `lockedAt` and `lockedBy` track when case becomes read-only
- Applied when `status = RELEASED_TO_PAYROLL`

### 4. Case Compensation

**Decimal Precision**:
- `@db.Decimal(12, 2)` for currency: up to 9,999,999,999.99
- `@db.Decimal(10, 4)` for percentages: high precision for variance

**Snapshot Fields**:
- `benchmarkUsed`, `catchupPercentUsed`, `tenureMonthsUsed` freeze inputs
- `varianceAmount`, `variancePercent`, `recommendedIncreaseAmount` freeze outputs
- Prevents recalculation when rules change

**Override Fields**:
- `isOverride` boolean flag
- `overrideReason`, `overrideApprovedBy`, `overrideApprovedAt` for audit
- `approvedNewBaseSalary` stores override value

**Computed Fields**:
- `currentTotalCompensation` = sum of base + allowances + bonuses
- `approvedTotalCompensation` = sum of approved components
- `approvedAmountDifference` and `approvedPercentDifference` for display

### 5. Computation Snapshots

**Purpose**:
- Created when Admin applies market rules snapshot to cycle
- Immutable record of recommendation at that point in time
- Used when cycle is sealed to prevent recalculation

**One-to-One with Case**:
- `caseId` unique constraint ensures single snapshot per case
- Links to both `cycleId` and `caseId` for querying

### 6. Approvals and Attachments

**Approval Metadata**:
- `approvalType` extensible string (EMAIL default)
- `status` enum: PENDING → RECEIVED → VERIFIED
- `approvalDate` when client approved
- `approvedByName` freeform text (client name, not system user)

**Attachment Strategy**:
- ONE of `storageKey` OR `driveUrl` populated per attachment
- `attachmentType` enum enforces mutual exclusivity
- Multiple attachments per approval supported (array relation)

**File Metadata**:
- `fileName`, `fileSize`, `mimeType` for display
- `checksum` (SHA-256) for integrity verification

### 7. Checklist

**Item Design**:
- `itemKey` identifies checklist item type (HR_REVIEW, FINANCE_APPROVAL)
- `assignedRole` determines who can complete
- `completed` boolean with `completedBy` and `completedAt` audit

**Unique Constraint**:
- `(caseId, itemKey)` prevents duplicate checklist items
- Items created on case creation or dynamically

**Immutability**:
- Once `completed = true`, cannot set back to false (enforced in business logic)
- Locked when cycle sealed

### 8. Movement Logs

**Append-Only Audit**:
- Never updated or deleted
- `movementType` enum for quick filtering
- `fieldName`, `oldValue`, `newValue` for field changes

**Use Cases**:
- Intake upload adds ADDED entry for new cases
- Intake upload adds REMOVED entry for missing staff IDs
- Intake upload adds RE_ADDED entry for previously removed staff IDs
- Intake upload adds FIELD_CHANGE for each updated field

### 9. Uploads

**Batch Tracking**:
- `UploadBatch` stores metadata: who, when, counts
- `uploadType` distinguishes INTAKE vs COMPENSATION
- `processingStatus` for async processing monitoring

**Row Results**:
- `UploadRowResult` one per row uploaded
- `status`: IMPORTED, FLAGGED, ERROR
- `flags` array: multiple flags per row (DUPLICATE_STAFF_ID, MISSING_NAME)
- `rawData` JSON stores original row for questionable report

**Movement Counts**:
- `addedCount`, `removedCount`, `readdedCount`, `updatedCount` on batch
- Only applicable to INTAKE uploads
- Useful for summary display

### 10. Market Rules Engine

**Tenure Bands**:
- `minMonths` and `maxMonths` inclusive range
- Named for readability ("1-2 years")
- Indexed for fast lookup during computation

**Market Benchmarks**:
- Unique on `(staffRole, tenureBandId)` prevents duplicates
- `catchupPercent` optional: if null, use global default
- `isActive` allows soft-delete of benchmarks

**Global Settings**:
- Key-value store for system-wide config
- `DEFAULT_CATCHUP_PERCENT`, `ALLOWED_EMAIL_DOMAINS`
- Avoids hardcoding in application

### 11. Manager Overrides

**Scope Enum**:
- GLOBAL: applies across all cycles
- CYCLE: applies only to specific cycle

**Unique Constraint**:
- `(employeeStaffId, scope, cycleId)` prevents duplicate overrides
- For GLOBAL scope, `cycleId` is NULL

**Precedence Logic**:
- Query CYCLE scope first for given cycleId
- If not found, query GLOBAL scope
- If not found, use intake value

**Audit Trail**:
- `previousManagerStaffId` stores old value
- `createdBy` and `createdAt` track who made change
- Audit events table also logs override changes

### 12. Permissions

**Field Groups**:
- Logical grouping of fields ("Current Compensation", "Approvals")
- `fields` array stores field keys for dynamic permission checks
- Reusable across multiple roles

**Permission Matrix**:
- `FieldGroupPermission` links `FieldGroup` and `Role`
- `canView` and `canEdit` granular permissions
- Middleware queries this table to filter API responses

**Example**:
```
FieldGroup: "Current Compensation"
  fields: ["current_base_salary", "current_fixed_allowances", "current_variable_allowances"]
  
FieldGroupPermission:
  fieldGroupId: "Current Compensation"
  roleId: "HR"
  canView: true
  canEdit: true
  
FieldGroupPermission:
  fieldGroupId: "Current Compensation"
  roleId: "MANAGER"
  canView: true
  canEdit: false
```

### 13. Audit Events

**Comprehensive Tracking**:
- `entityType` and `entityId` for polymorphic logging
- `action` string for flexibility (CREATED, UPDATED, STATUS_CHANGED, etc.)
- `before`, `after`, `changes` JSON for state comparison

**Actor Information**:
- `actorId` references User (can be NULL if user deleted)
- `actorEmail` and `actorName` denormalized for permanent history
- `ipAddress` and `userAgent` for security investigations

**Indexing**:
- `(entityType, entityId, createdAt)` for entity timeline queries
- `actorId` for "what did this user do"
- `createdAt` for chronological reports

### 14. Notifications

**Queue-Based Design**:
- `NotificationQueue` table for async email sending
- `status` enum: PENDING → SENT or FAILED
- `retryCount` and `errorMessage` for failure handling

**Priority**:
- OTP emails: priority 1 (immediate)
- Reminders: priority 5 (normal)
- Summaries: priority 10 (low)

**Worker Pattern**:
- Background worker polls for PENDING with lowest priority value
- Updates status to SENT on success
- Increments retryCount and sets FAILED after 3 attempts

---

## Indexes Summary

### Critical Indexes for Performance

```sql
-- User lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_staff_id ON users(staff_id);

-- Session authentication
CREATE INDEX idx_sessions_access_token ON sessions(access_token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- OTP verification
CREATE INDEX idx_otp_email_verified_expires ON otp_codes(email, verified, expires_at);

-- Cycle filtering
CREATE INDEX idx_cycles_type_active ON cycles(type, is_active);
CREATE INDEX idx_cycles_sealed ON cycles(sealed);

-- Case queries (most critical for performance)
CREATE INDEX idx_cases_cycle_status ON appraisal_cases(cycle_id, status);
CREATE INDEX idx_cases_staff_id ON appraisal_cases(staff_id);
CREATE INDEX idx_cases_resolved_manager ON appraisal_cases(resolved_manager_staff_id);
CREATE INDEX idx_cases_company ON appraisal_cases(company_name);
CREATE INDEX idx_cases_role ON appraisal_cases(staff_role);
CREATE INDEX idx_cases_missing_benchmark ON appraisal_cases(is_missing_benchmark);
CREATE INDEX idx_cases_has_override ON appraisal_cases(has_override);

-- Movement log timeline
CREATE INDEX idx_movement_case_time ON case_movement_logs(case_id, timestamp);

-- Upload tracking
CREATE INDEX idx_batches_cycle_type ON upload_batches(cycle_id, upload_type);
CREATE INDEX idx_row_results_batch_status ON upload_row_results(batch_id, status);

-- Market rules lookup
CREATE INDEX idx_tenure_bands_range ON tenure_bands(min_months, max_months);
CREATE INDEX idx_benchmarks_role ON market_benchmarks(staff_role);
CREATE INDEX idx_benchmarks_band ON market_benchmarks(tenure_band_id);

-- Manager override resolution
CREATE INDEX idx_overrides_employee ON manager_overrides(employee_staff_id);
CREATE INDEX idx_overrides_scope_cycle ON manager_overrides(scope, cycle_id);

-- Audit timeline
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_events(actor_id);

-- Notification processing
CREATE INDEX idx_notifications_processing ON notification_queue(status, priority, created_at);
```

---

## Data Integrity Constraints

### Foreign Key Cascade Behavior

**Cascade on Delete**:
- `UserRole` → `User`: Cascade (remove roles when user deleted)
- `Session` → `User`: Cascade (remove sessions when user deleted)
- `AppraisalCase` → `Cycle`: Cascade (remove cases when cycle deleted, rare)
- `CaseCompensation` → `AppraisalCase`: Cascade
- `CaseApproval` → `AppraisalCase`: Cascade
- `CaseChecklistItem` → `AppraisalCase`: Cascade
- `CaseMovementLog` → `AppraisalCase`: Cascade
- `ApprovalAttachment` → `CaseApproval`: Cascade
- `UploadRowResult` → `UploadBatch`: Cascade

**Set Null on Delete**:
- `AppraisalCase.updatedBy` → `User`: Set Null (preserve case even if user deleted)
- `CaseChecklistItem.completedBy` → `User`: Set Null (preserve completion history)
- `AuditEvent.actorId` → `User`: Set Null (preserve audit trail with denormalized email/name)

### Unique Constraints

- `User.email`: Enforce unique logins
- `User.staffId`: Prevent duplicate staff IDs in user table
- `Role.name`: Prevent duplicate role names
- `UserRole(userId, roleId)`: Prevent duplicate role assignments
- `Cycle`: No unique name required (can have multiple "Annual AU FY" across years)
- `AppraisalCase(cycleId, staffId)`: One case per employee per cycle
- `CaseCompensation.caseId`: One compensation record per case
- `CaseChecklistItem(caseId, itemKey)`: One checklist item per key per case
- `TenureBand.name`: Unique band names
- `MarketBenchmark(staffRole, tenureBandId)`: One benchmark per role-band combination
- `ManagerOverride(employeeStaffId, scope, cycleId)`: Prevent duplicate overrides

### Check Constraints (Enforce via Application or DB Triggers)

- `OtpCode.attempts >= 0`
- `TenureBand.maxMonths > minMonths`
- `MarketBenchmark.catchupPercent BETWEEN 1 AND 100` (if not null)
- `CaseCompensation.currentBaseSalary >= 0`
- `CaseCompensation.recommendedNewBase >= 0`
- `ApprovalAttachment`: Either `storageKey IS NOT NULL` OR `driveUrl IS NOT NULL` (XOR constraint)

---

## Migrations Strategy

### Initial Migration

```bash
npx prisma migrate dev --name init
```

This creates the full schema as defined above.

### Subsequent Migrations

For schema changes:
```bash
npx prisma migrate dev --name add_effectivity_status_field
```

For production:
```bash
npx prisma migrate deploy
```

### Seed Data

**Create seed script** (`prisma/seed.ts`):
```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create roles
  const adminRole = await prisma.role.create({
    data: { name: 'ADMIN', description: 'System administrator' },
  });
  
  const hrRole = await prisma.role.create({
    data: { name: 'HR', description: 'Human resources' },
  });
  
  const financeRole = await prisma.role.create({
    data: { name: 'FINANCE', description: 'Finance team' },
  });
  
  const payrollRole = await prisma.role.create({
    data: { name: 'PAYROLL', description: 'Payroll processing' },
  });
  
  const managerRole = await prisma.role.create({
    data: { name: 'MANAGER', description: 'Line manager' },
  });
  
  // Create admin user
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@yourcompany.com',
      emailDomain: 'yourcompany.com',
      fullName: 'System Administrator',
      isActive: true,
    },
  });
  
  await prisma.userRole.create({
    data: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });
  
  // Add email domain whitelist
  await prisma.emailDomainWhitelist.create({
    data: {
      domain: 'yourcompany.com',
      isActive: true,
    },
  });
  
  // Global settings
  await prisma.globalSettings.create({
    data: {
      key: 'DEFAULT_CATCHUP_PERCENT',
      value: '75',
      description: 'Default catch-up percentage for market adjustments',
    },
  });
  
  // Create sample tenure bands
  const band1 = await prisma.tenureBand.create({
    data: { name: '0-6 months', minMonths: 0, maxMonths: 6 },
  });
  
  const band2 = await prisma.tenureBand.create({
    data: { name: '6-12 months', minMonths: 7, maxMonths: 12 },
  });
  
  const band3 = await prisma.tenureBand.create({
    data: { name: '1-2 years', minMonths: 13, maxMonths: 24 },
  });
  
  const band4 = await prisma.tenureBand.create({
    data: { name: '2-5 years', minMonths: 25, maxMonths: 60 },
  });
  
  const band5 = await prisma.tenureBand.create({
    data: { name: '5+ years', minMonths: 61, maxMonths: 9999 },
  });
  
  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Run seed:
```bash
npx prisma db seed
```

---

## Query Examples

### 1. Get Cases for Manager View

```typescript
const managerStaffId = '12345';

const cases = await prisma.appraisalCase.findMany({
  where: {
    cycleId: currentCycleId,
    resolvedManagerStaffId: managerStaffId,
    isRemoved: false,
  },
  include: {
    compensation: true,
    approvals: {
      include: { attachments: true },
    },
    checklistItems: true,
  },
  orderBy: { fullName: 'asc' },
});
```

### 2. Resolve Manager with Override Precedence

```typescript
async function resolveManager(staffId: string, cycleId: string): Promise<string | null> {
  // Try cycle-specific override
  const cycleOverride = await prisma.managerOverride.findUnique({
    where: {
      employeeStaffId_scope_cycleId: {
        employeeStaffId: staffId,
        scope: 'CYCLE',
        cycleId: cycleId,
      },
    },
  });
  
  if (cycleOverride) return cycleOverride.managerStaffId;
  
  // Try global override
  const globalOverride = await prisma.managerOverride.findFirst({
    where: {
      employeeStaffId: staffId,
      scope: 'GLOBAL',
    },
  });
  
  if (globalOverride) return globalOverride.managerStaffId;
  
  // Use intake value
  const appraisalCase = await prisma.appraisalCase.findUnique({
    where: {
      cycleId_staffId: { cycleId, staffId },
    },
    select: { managerStaffIdFromIntake: true },
  });
  
  return appraisalCase?.managerStaffIdFromIntake || null;
}
```

### 3. Compute Recommendation with Benchmark Lookup

```typescript
async function computeRecommendation(caseId: string) {
  const appraisalCase = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: { compensation: true },
  });
  
  if (!appraisalCase) throw new Error('Case not found');
  
  // Find tenure band
  const tenureBand = await prisma.tenureBand.findFirst({
    where: {
      minMonths: { lte: appraisalCase.tenureMonths },
      maxMonths: { gte: appraisalCase.tenureMonths },
    },
  });
  
  if (!tenureBand) {
    await prisma.appraisalCase.update({
      where: { id: caseId },
      data: { isMissingBenchmark: true },
    });
    return;
  }
  
  // Find market benchmark
  const benchmark = await prisma.marketBenchmark.findUnique({
    where: {
      staffRole_tenureBandId: {
        staffRole: appraisalCase.staffRole,
        tenureBandId: tenureBand.id,
      },
    },
  });
  
  if (!benchmark) {
    await prisma.appraisalCase.update({
      where: { id: caseId },
      data: { isMissingBenchmark: true },
    });
    return;
  }
  
  // Get catch-up percent
  let catchupPercent = benchmark.catchupPercent;
  if (!catchupPercent) {
    const globalSetting = await prisma.globalSettings.findUnique({
      where: { key: 'DEFAULT_CATCHUP_PERCENT' },
    });
    catchupPercent = parseInt(globalSetting?.value || '75');
  }
  
  // Calculate recommendation
  const currentBase = parseFloat(appraisalCase.compensation.currentBaseSalary.toString());
  const benchmarkBase = parseFloat(benchmark.baseSalary.toString());
  
  const varianceAmount = benchmarkBase - currentBase;
  const variancePercent = currentBase > 0 ? varianceAmount / currentBase : null;
  
  let recommendedIncreaseAmount = 0;
  let recommendedNewBase = currentBase;
  let recommendedAdjustmentPercent = 0;
  
  if (currentBase < benchmarkBase) {
    recommendedIncreaseAmount = varianceAmount * (catchupPercent / 100);
    recommendedNewBase = currentBase + recommendedIncreaseAmount;
    recommendedAdjustmentPercent = recommendedIncreaseAmount / currentBase;
  }
  
  // Update compensation with snapshot
  await prisma.caseCompensation.update({
    where: { caseId: caseId },
    data: {
      benchmarkUsed: benchmark.baseSalary,
      catchupPercentUsed: catchupPercent,
      tenureMonthsUsed: appraisalCase.tenureMonths,
      tenureComputedAt: new Date(),
      varianceAmount,
      variancePercent,
      recommendedIncreaseAmount,
      recommendedNewBase,
      recommendedAdjustmentPercent: variancePercent !== null ? recommendedAdjustmentPercent : null,
    },
  });
  
  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: { isMissingBenchmark: false },
  });
}
```

### 4. Audit Event Creation

```typescript
async function createAuditEvent(
  entityType: string,
  entityId: string,
  action: string,
  actorId: string,
  before: any,
  after: any
) {
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  
  const changes = computeDiff(before, after); // Custom diff function
  
  await prisma.auditEvent.create({
    data: {
      entityType,
      entityId,
      action,
      actorId,
      actorEmail: actor?.email,
      actorName: actor?.fullName,
      before,
      after,
      changes,
    },
  });
}
```

---

## Performance Considerations

### Connection Pooling

Configure Prisma connection pool:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/salary_appraisal?connection_limit=20&pool_timeout=30"
```

### Query Optimization

**Use Select to Limit Fields**:
```typescript
const cases = await prisma.appraisalCase.findMany({
  select: {
    id: true,
    staffId: true,
    fullName: true,
    status: true,
  },
});
```

**Include Only Required Relations**:
```typescript
// Good: Only include what you need
const caseWithComp = await prisma.appraisalCase.findUnique({
  where: { id },
  include: { compensation: true },
});

// Avoid: Including unnecessary deep relations
const caseWithAll = await prisma.appraisalCase.findUnique({
  where: { id },
  include: {
    compensation: true,
    approvals: { include: { attachments: true } },
    checklistItems: { include: { completer: true } },
    movementLogs: true,
  },
});
```

**Cursor-Based Pagination for Large Lists**:
```typescript
const cases = await prisma.appraisalCase.findMany({
  take: 50,
  skip: 1,
  cursor: { id: lastCaseId },
  orderBy: { id: 'asc' },
});
```

### Batch Operations

**Use `createMany` for Bulk Inserts**:
```typescript
await prisma.uploadRowResult.createMany({
  data: rowResults,
  skipDuplicates: true,
});
```

**Use Transactions for Consistency**:
```typescript
await prisma.$transaction(async (tx) => {
  await tx.appraisalCase.update({
    where: { id: caseId },
    data: { status: 'APPROVED' },
  });
  
  await tx.auditEvent.create({
    data: {
      entityType: 'CASE',
      entityId: caseId,
      action: 'STATUS_CHANGED',
      actorId: userId,
    },
  });
});
```

---

This completes the database schema documentation. The schema is designed to be:
- **Auditable**: Full change tracking with append-only logs
- **Performant**: Strategic indexes for 700+ cases
- **Flexible**: Extensible enums and JSON fields where appropriate
- **Consistent**: Strong referential integrity with proper cascade behavior
- **Maintainable**: Clear naming conventions and comprehensive documentation
