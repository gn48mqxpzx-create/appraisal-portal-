# Salary Appraisal Workflow and Compensation Processing System
## Complete System Design Specification

### Document Version: 1.0
### Date: February 26, 2026

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Database Schema](#database-schema)
4. [API Contracts](#api-contracts)
5. [Business Rules and Algorithms](#business-rules-and-algorithms)
6. [UI Architecture](#ui-architecture)
7. [Security and Performance](#security-and-performance)
8. [Repository Structure](#repository-structure)
9. [Deployment Strategy](#deployment-strategy)

---

## Executive Summary

### Purpose
Internal compensation appraisal workflow system managing the complete lifecycle from employee scope identification through market-based recommendations, multi-stage approvals, to payroll export.

### Scale
- **Volume**: ~700 employees per cycle
- **Concurrent Cycles**: Multiple (Annual AU FY + Anniversary)
- **User Base**: 5-7 distinct roles with granular permissions
- **Audit Requirements**: Full historical tracking, immutable sealed records

### Key Principles
1. **Database as System of Record**: All state lives in PostgreSQL
2. **Auditability First**: Every change tracked with who/when/what
3. **Controlled State Transitions**: Explicit locking at cycle and case levels
4. **Read-Only Preservation**: Sealed cycles are permanently immutable
5. **Permission Granularity**: Role-based + field-group access control
6. **Non-Blocking Imports**: Uploads never fail due to data flags; all rows processed and results captured per-row
7. **Dynamic Mapping**: System detects unmapped values during imports and presents Admin UI for mapping without halting imports
8. **Immutable History**: Row-level flags and raw data preserved in upload_row_results for audit and traceability

---

## System Architecture

### Technology Stack

```
┌─────────────────────────────────────────────────┐
│              React + Tailwind CSS               │
│           (Single Page Application)              │
└─────────────────┬───────────────────────────────┘
                  │ REST API (JSON)
┌─────────────────▼───────────────────────────────┐
│           Node.js + Express API                  │
│  ┌──────────────────────────────────────────┐  │
│  │  Auth Middleware (OTP Session)           │  │
│  │  Role & Permission Middleware            │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Controllers                              │  │
│  │  Services (Business Logic)               │  │
│  │  Validators                               │  │
│  └──────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────┘
                  │ Prisma ORM
┌─────────────────▼───────────────────────────────┐
│            PostgreSQL 14+                        │
│  - ACID compliance for audit integrity          │
│  - Row-level security ready                     │
│  - Full-text search for case filtering          │
└──────────────────────────────────────────────────┘
```

### Application Layers

**Presentation Layer** (React)
- Component-based UI with reusable patterns
- Client-side routing (React Router)
- State management (Context API + React Query for server state)
- Form handling with validation
- CSV/Excel export generation

**API Layer** (Node.js/Express)
- RESTful endpoints
- Middleware stack: logging → auth → permissions → validation
- Service layer for business logic isolation
- Repository pattern via Prisma

**Data Layer** (PostgreSQL)
- Normalized relational design
- Audit tables using event sourcing pattern
- Computed columns for denormalization where needed
- Indexes optimized for filtering and joins

### Cross-Cutting Concerns

**Authentication**
- OTP generation and verification service
- Email delivery via SendGrid/AWS SES
- Session token management (JWT with refresh tokens)
- Rate limiting per email and IP

**Authorization**
- Role-based access control (RBAC)
- Field-group permissions with dynamic resolution
- Manager visibility filtering (resolved manager_staff_id)
- Action-level permissions (view/edit/approve)

**Audit Logging**
- Append-only audit events table
- Captures: entity, entity_id, action, actor, timestamp, before/after
- Queryable via API for timeline display
- Never deleted, even when parent records soft-deleted

**File Storage**
- Approval evidence PDFs stored locally or S3-compatible
- Secure signed URLs for download
- Virus scanning on upload (ClamAV hook point)
- File metadata: size, mime_type, checksum

---

## Database Schema

### Core Principles
1. **Audit Everything**: `created_at`, `created_by`, `updated_at`, `updated_by` on mutable entities
2. **Soft Deletes**: Use `deleted_at` rather than hard deletes where appropriate
3. **Immutability**: Sealed cycles enforce read-only via application logic and DB constraints
4. **Referential Integrity**: Foreign keys with appropriate cascade behavior

### Prisma Schema

See `DATABASE_SCHEMA.md` for full Prisma schema definition.

### Entity Relationship Overview

```
users ──< sessions
users ──< audit_events
users ──< user_roles ─> roles

cycles ──< appraisal_cases
cycles ──< upload_batches
cycles ──< manager_overrides (cycle-scoped)
cycles ──< computation_snapshots

appraisal_cases ──< case_compensation
appraisal_cases ──< case_approvals ──< approval_attachments
appraisal_cases ──< case_checklist_items
appraisal_cases ──< case_movement_logs

upload_batches ──< upload_row_results

contact_type_mappings ── user (created_by)
unmapped_value_events ── user (resolved_by)

tenure_bands ──< market_benchmarks

field_groups ──< field_group_permissions ─> roles
```

### Key Tables Summary

| Table | Purpose | Locking Behavior |
|-------|---------|------------------|
| `cycles` | Cycle definition | Sealing sets `sealed_at`, enables read-only |
| `appraisal_cases` | Core case entity | Locked when `status = RELEASED_TO_PAYROLL` |
| `case_compensation` | Current & approved comp | Locked with case |
| `case_approvals` | Evidence tracking | Locked when cycle sealed |
| `case_checklist_items` | Workflow progress | Cannot uncheck, locked on seal |
| `case_movement_logs` | Scope change history | Append-only, never locked |
| `upload_batches` | Import metadata | Immutable after processing |
| `upload_row_results` | Row-level results (with flags) | Immutable after processing |
| `contact_type_mappings` | Dynamic mapping rules | Versioned, updated as admin resolves unmapped values |
| `unmapped_value_events` | Unmapped value tracking | Tracks detected unmapped values across uploads |
| `market_benchmarks` | Rules engine data | Versioned, snapshot on apply |
| `computation_snapshots` | Frozen recommendations | Created once, never modified |
| `manager_overrides` | Global & cycle overrides | Audited, precedence evaluated |
| `audit_events` | Change log | Append-only, never modified |

---

## API Contracts

See `API_CONTRACTS.md` for complete endpoint definitions.

### API Design Principles
- **RESTful**: Resource-oriented URLs
- **Consistent Response Shape**: `{ success: boolean, data?: any, error?: string, meta?: object }`
- **Standard HTTP Codes**: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error
- **Pagination**: Query params `page`, `limit`, response includes `{ items, total, page, totalPages }`
- **Filtering**: Query params match field names, support operators like `status=DRAFT,IN_REVIEW`
- **Sorting**: Query param `sort=field:asc` or `sort=field:desc`

### Endpoint Categories

1. **Authentication** (`/api/auth/*`)
   - OTP request, verify, logout, session refresh

2. **Cycles** (`/api/cycles/*`)
   - CRUD operations, activation, lock imports, seal

3. **Cases** (`/api/cases/*`)
   - List with filters, detail, update fields, status transitions

4. **Compensation** (`/api/cases/:id/compensation`)
   - Update current, update approved, compute recommendation

5. **Approvals** (`/api/cases/:id/approvals`)
   - Create, attach file, attach Drive link, update status

6. **Checklist** (`/api/cases/:id/checklist`)
   - Get items, complete item

7. **Uploads** (`/api/uploads/*`)
   - Intake upload, compensation upload, download questionable report

8. **Market Rules** (`/api/market-rules/*`)
   - Tenure bands, benchmarks, catch-up percents, impact preview, apply snapshot

9. **Overrides** (`/api/overrides/*`)
   - Manager overrides (global/cycle), resolve manager for case

10. **Exports** (`/api/exports/*`)
    - Payroll export, removed cases, movement logs, overrides report

11. **Dashboard** (`/api/dashboard/*`)
    - Cycle stats, blockers summary, completion by department

12. **Admin** (`/api/admin/*`)
    - Field groups, permissions, users, roles, domain whitelist

---

## Business Rules and Algorithms

See `BUSINESS_RULES.md` for detailed specifications.

### Critical Algorithm Summaries

#### 1. Intake Upload Processing (Non-Blocking, Sync-Based Scope)

```
INPUT: CSV file, cycle_id
PRECONDITION: cycle.imports_locked = false

STEP 1: Parse and validate rows (NEVER HALT ON ERRORS OR FLAGS)
  - Check required fields
  - Flag duplicates (keep first occurrence, flag rest as DUPLICATE_STAFF_ID)
  - Detect unmapped contact types, map them, flag if unmapped
  - Generate upload_row_results records with status: IMPORTED | FLAGGED | ERROR
  - Record unmapped raw values for admin review (unmapped_value_events table)
  
  KEY PRINCIPLE: All rows processed. Row status recorded. No batch failure.

STEP 2: Build in-scope set from valid/imported rows
  in_scope_staff_ids = [unique staff_ids from rows WHERE status = IMPORTED]

STEP 3: Detect removed cases
  existing_in_scope = SELECT staff_id FROM appraisal_cases 
                      WHERE cycle_id = X AND status != 'REMOVED_FROM_SCOPE'
  
  removed_staff_ids = existing_in_scope - in_scope_staff_ids
  
  FOR EACH removed_staff_id:
    UPDATE case SET status = 'REMOVED_FROM_SCOPE', close_date = NOW()
    INSERT INTO case_movement_logs (type = 'REMOVED', ...)

STEP 4: Detect re-added cases
  previously_removed = SELECT staff_id FROM appraisal_cases
                       WHERE cycle_id = X AND status = 'REMOVED_FROM_SCOPE'
  
  readded_staff_ids = in_scope_staff_ids ∩ previously_removed
  
  FOR EACH readded_staff_id:
    UPDATE case SET status = 'DRAFT', close_date = NULL
    INSERT INTO case_movement_logs (type = 'RE_ADDED', ...)

STEP 5: Upsert in-scope cases
  FOR EACH row WHERE status = IMPORTED:
    mapped_contact_type = mapContactType(row.rawContactType)
    
    IF case EXISTS:
      Detect field changes (name, company, role, manager_id, sm_id, rm_id)
      UPDATE case fields using mapped_contact_type
      INSERT movement_log entries for each change
    ELSE:
      INSERT new case with mapped_contact_type and raw_contact_type for traceability
      INSERT movement_log (type = 'ADDED', ...)

STEP 6: Summary and reporting
  imported_count = COUNT rows WHERE status = IMPORTED
  flagged_count = COUNT rows WHERE status = FLAGGED
  error_count = COUNT rows WHERE status = ERROR
  
  Generate questionable-data report with all flagged/error rows and raw data

STEP 7: Return upload batch result
  {
    imported_count,
    flagged_count,
    error_count,
    added_count,
    removed_count,
    readded_count,
    updated_count
  }
```

#### 2. Manager Resolution with Overrides

```
FUNCTION resolve_manager_staff_id(case):
  cycle_override = SELECT manager_staff_id 
                   FROM manager_overrides 
                   WHERE employee_staff_id = case.staff_id 
                     AND scope = 'CYCLE'
                     AND cycle_id = case.cycle_id
  
  IF cycle_override EXISTS:
    RETURN cycle_override.manager_staff_id
  
  global_override = SELECT manager_staff_id 
                    FROM manager_overrides 
                    WHERE employee_staff_id = case.staff_id 
                      AND scope = 'GLOBAL'
  
  IF global_override EXISTS:
    RETURN global_override.manager_staff_id
  
  RETURN case.manager_staff_id_from_intake
```

#### 3. Market Recommendation Computation

```
FUNCTION compute_recommendation(case):
  INPUT: case with current_base_salary, staff_role, tenure_months
  
  STEP 1: Resolve tenure band
    band = SELECT * FROM tenure_bands 
           WHERE min_months <= case.tenure_months 
             AND max_months >= case.tenure_months
    
    IF NOT band:
      RETURN { is_missing_benchmark: true, recommended_increase_amount: 0 }
  
  STEP 2: Resolve market benchmark
    benchmark = SELECT * FROM market_benchmarks
                WHERE staff_role = case.staff_role
                  AND tenure_band_id = band.id
    
    IF NOT benchmark:
      RETURN { is_missing_benchmark: true, recommended_increase_amount: 0 }
  
  STEP 3: Get catch-up percent
    catch_up_percent = benchmark.catch_up_percent 
                       ?? global_default_catch_up_percent
  
  STEP 4: Compute variance
    variance_amount = benchmark.base_salary - case.current_base_salary
    
    IF case.current_base_salary = 0:
      variance_percent = NULL
      FLAG case with zero_base_salary_error
    ELSE:
      variance_percent = variance_amount / case.current_base_salary
  
  STEP 5: Compute recommendation
    IF case.current_base_salary < benchmark.base_salary:
      recommended_increase_amount = variance_amount * (catch_up_percent / 100)
      recommended_new_base = case.current_base_salary + recommended_increase_amount
      recommended_adjustment_percent = recommended_increase_amount / case.current_base_salary
    ELSE:
      recommended_increase_amount = 0
      recommended_new_base = case.current_base_salary
      recommended_adjustment_percent = 0
      display_message = "No adjustment recommended - current salary meets or exceeds benchmark"
  
  STEP 6: Store snapshot
    UPDATE case_compensation SET
      benchmark_used = benchmark.base_salary,
      catch_up_percent_used = catch_up_percent,
      tenure_months_used = case.tenure_months,
      tenure_computed_at = NOW(),
      variance_amount,
      variance_percent,
      recommended_increase_amount,
      recommended_new_base,
      recommended_adjustment_percent,
      is_missing_benchmark = false
  
  RETURN snapshot
```

#### 4. Impact Preview for Market Rules Changes

```
FUNCTION preview_market_rules_impact(cycle_id, proposed_changes):
  INPUT: 
    - cycle_id
    - proposed_changes: { benchmarks: [...], catch_up_percents: [...] }
  
  STEP 1: Get all active cases
    cases = SELECT * FROM appraisal_cases 
            WHERE cycle_id = cycle_id 
              AND status != 'REMOVED_FROM_SCOPE'
  
  STEP 2: Compute current vs proposed for each case
    results = []
    total_current_increase = 0
    total_proposed_increase = 0
    
    FOR EACH case:
      current_snapshot = get_current_recommendation(case)
      proposed_snapshot = compute_recommendation(case, proposed_changes)
      
      delta_increase = proposed_snapshot.recommended_increase_amount 
                       - current_snapshot.recommended_increase_amount
      
      results.append({
        case_id: case.id,
        staff_id: case.staff_id,
        staff_role: case.staff_role,
        current_recommended: current_snapshot.recommended_increase_amount,
        proposed_recommended: proposed_snapshot.recommended_increase_amount,
        delta_increase
      })
      
      total_current_increase += current_snapshot.recommended_increase_amount
      total_proposed_increase += proposed_snapshot.recommended_increase_amount
  
  STEP 3: Aggregate by staff_role and tenure_band
    breakdown = GROUP_BY(results, ['staff_role', 'tenure_band'])
    
  RETURN {
    affected_cases_count: cases.length,
    total_current_increase,
    total_proposed_increase,
    total_delta: total_proposed_increase - total_current_increase,
    breakdown_by_role_and_band: breakdown,
    case_level_details: results
  }
```

#### 5. Cycle Sealing Enforcement

```
FUNCTION seal_cycle(cycle_id, user_id):
  PRECONDITION: cycle.imports_locked = true
  
  STEP 1: Validate all cases ready
    incomplete_cases = SELECT COUNT(*) FROM appraisal_cases
                       WHERE cycle_id = cycle_id
                         AND status NOT IN ('APPROVED', 'RELEASED_TO_PAYROLL', 'REMOVED_FROM_SCOPE')
    
    IF incomplete_cases > 0:
      THROW Error("Cannot seal cycle with incomplete cases")
  
  STEP 2: Create final computation snapshot
    FOR EACH case WHERE status IN ('APPROVED', 'RELEASED_TO_PAYROLL'):
      IF NOT computation_snapshot EXISTS:
        CREATE computation_snapshot FROM case_compensation current state
  
  STEP 3: Mark cycle as sealed
    UPDATE cycles SET 
      sealed_at = NOW(),
      sealed_by = user_id
  
  STEP 4: Audit event
    INSERT INTO audit_events (
      entity_type = 'CYCLE',
      entity_id = cycle_id,
      action = 'SEALED',
      actor_id = user_id,
      ...
    )
  
  STEP 5: Trigger notifications
    SEND email to Finance, Payroll: "Cycle sealed, ready for final export"
```

#### 6. Questionable Data Report Generation

```
FUNCTION generate_questionable_report(upload_batch_id):
  rows = SELECT * FROM upload_row_results
         WHERE upload_batch_id = upload_batch_id
           AND (status = 'FLAGGED' OR status = 'ERROR')
         ORDER BY row_number
  
  csv_rows = []
  
  FOR EACH row:
    csv_rows.append({
      row_number: row.row_number,
      staff_id: row.raw_data.staff_id,
      full_name: row.raw_data.full_name,
      status: row.status,
      flags: row.flags.join(", "),
      error_message: row.error_message,
      raw_data: JSON.stringify(row.raw_data)
    })
  
  RETURN CSV.generate(csv_rows)
```

---

## UI Architecture

See `UI_ARCHITECTURE.md` for complete component specifications.

### Page Structure

#### 1. Cycle Control Center
**Route**: `/cycles`

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│ [Cycle Selector Dropdown]     [+ Create New Cycle]      │
├─────────────────────────────────────────────────────────┤
│ Cycle: Annual AU FY 2026          Status: Active        │
│ Created: Jan 5, 2026              Imports: Unlocked     │
│                                                          │
│ Actions:                                                 │
│  [Lock Imports] [Seal Cycle]                            │
├─────────────────────────────────────────────────────────┤
│ Metrics (Cards Row):                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │ In-Scope│  │In Review│  │ Blocked │  │Approved │   │
│  │   683   │  │   124   │  │    8    │  │   551   │   │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│  ┌─────────┐  ┌─────────┐                              │
│  │Released │  │ Removed │                              │
│  │   412   │  │    17   │                              │
│  └─────────┘  └─────────┘                              │
└─────────────────────────────────────────────────────────┘
```

#### 2. Import Center
**Route**: `/imports`

**Sections**:
- **Upload Tabs**: Intake Upload | Compensation Upload
- **Upload History Table**: batch_id, uploaded_at, uploaded_by, row_count, imported, flagged, errors, [Download Report]
- **Movement Log View**: Filterable log of Added/Removed/Re-added/Updated events

#### 3. Case List
**Route**: `/cases`

**Features**:
- **Advanced Filters Panel**: Company, Role, SM, RM, Manager, Status, Has Override, Missing Benchmark, Removed
- **Table Columns**: Staff ID, Name, Company, Role, Manager, Status, Checklist Progress, Adjustment, [View]
- **Pagination**: Server-side, 50 rows per page
- **Bulk Actions**: Export selected, Update status (permission-based)

#### 4. Case Detail
**Route**: `/cases/:id`

**Layout Tabs**:
- **Overview**: Employee info, tenure, effectivity date
- **Compensation**: Current | Recommended | Approved (side-by-side comparison)
- **Recommendation**: Market benchmark, variance, computed values, missing data warnings
- **Override**: Toggle, reason, approved new base, evidence requirement
- **Approvals**: Evidence list with PDF viewer and Drive links, approval metadata
- **Checklist**: Progress bar, item list with completion status and timestamps
- **Audit Timeline**: Chronological event log with filters

#### 5. Dashboard
**Route**: `/dashboard`

**Widgets**:
- **Completion by Department**: Horizontal bar chart
- **Blockers Summary**: Table grouped by blocker reason
- **Overrides Analysis**: Count, total cost impact, avg adjustment
- **Missing Market Data**: Count with drill-down link
- **Ready for Payroll**: Count with export action

#### 6. Admin Market Rules Portal
**Route**: `/admin/market-rules`

**Sections**:
- **Tenure Bands Management**: CRUD table with min/max months
- **Market Benchmarks Table**: Role, Tenure Band, Base Salary, Catch-Up %, [Edit]
- **Global Default**: Input for default catch-up percent
- **Impact Preview**: [Preview Changes] button → modal showing affected cases and cost delta
- **Apply Snapshot**: [Apply to Cycle] dropdown → applies frozen snapshot

#### 7. Admin Permissions Portal
**Route**: `/admin/permissions`

**Sections**:
- **Field Groups**: Define logical groupings (e.g., "Current Compensation", "Approvals")
- **Permissions Matrix**: Table with roles as columns, field groups as rows, checkboxes for View/Edit
- **Audit Log**: Changes to permissions config

### Component Library Structure

**Reusable Components**:
- `<DataTable>` with sorting, filtering, pagination
- `<FilterPanel>` with dynamic filter builders
- `<StatusBadge>` with color coding per status
- `<ChecklistProgress>` visual progress bar
- `<AuditTimeline>` chronological event display
- `<FileUploadZone>` with drag-drop and progress
- `<PDFViewer>` embedded viewer for approval evidence
- `<ConfirmationModal>` for critical actions
- `<ImpactPreviewModal>` for market rules changes
- `<FormField>` with validation error display
- `<PermissionGate>` renders children only if permission granted

**Layout Components**:
- `<AppShell>` top nav + side nav wrapper
- `<TopNav>` user menu, cycle selector, notifications bell
- `<SideNav>` role-based menu links
- `<PageContainer>` responsive max-width, padding
- `<PageHeader>` title, breadcrumbs, actions
- `<Card>` metric cards, section containers

**Styling Patterns**:
- Primary action buttons: `bg-blue-600 hover:bg-blue-700 text-white`
- Destructive actions: `bg-red-600 hover:bg-red-700 text-white`
- Status badges: Green (approved), Yellow (in-review), Red (blocked), Gray (draft)
- Form inputs: `border-gray-300 focus:border-blue-500 focus:ring-blue-500`
- Tables: Striped rows with hover highlight, sticky headers on scroll

---

## Security and Performance

### Security Considerations

#### 1. Authentication Security
- **OTP Expiry**: 10 minutes, single-use tokens
- **Rate Limiting**: 
  - 5 OTP requests per email per hour
  - 10 OTP requests per IP per hour
  - 5 failed verification attempts per email (then temporary lockout)
- **Session Management**:
  - JWT access tokens (15 min expiry)
  - Refresh tokens (7 day expiry, stored in httpOnly cookie)
  - Token rotation on refresh
  - Secure token storage with bcrypt hashing in DB

#### 2. Authorization Security
- **Middleware Stack**: Every protected route validates:
  1. Valid session token
  2. User role active and not disabled
  3. Specific permission for action on resource
  4. Manager visibility filtering applied automatically
- **Field-Level Permissions**: Dynamically filter response payloads based on role's view permissions
- **Action-Level Permissions**: Operations like "lock imports", "seal cycle", "complete checklist" validate assigned role

#### 3. Input Validation
- **Schema Validation**: Joi/Zod for all request bodies
- **SQL Injection**: Prisma parameterized queries prevent injection
- **File Uploads**:
  - Max file size: 10MB for PDFs
  - Allowed MIME types: application/pdf
  - Filename sanitization
  - Virus scanning integration point
  - Storage path randomization (no user-controlled paths)

#### 4. Data Protection
- **PII Handling**: Staff compensation data is sensitive
  - REST API over HTTPS only
  - No logging of compensation values in plaintext logs
  - Audit events store diffs but protect via access control
- **Domain Whitelisting**: Only allowed email domains can authenticate
- **CORS Configuration**: Restrict origins to known frontend domains
- **CSRF Protection**: For state-changing operations

#### 5. Cycle and Case Locking
- **Immutability Enforcement**:
  - Middleware checks `cycle.sealed_at` before any mutation
  - Case-level checks for `status = RELEASED_TO_PAYROLL`
  - Returns 409 Conflict with clear error message
- **Optimistic Locking**: Use `updated_at` for concurrent edit detection

### Performance Considerations

#### 1. Database Optimization
- **Indexes**:
  ```sql
  CREATE INDEX idx_cases_cycle_status ON appraisal_cases(cycle_id, status);
  CREATE INDEX idx_cases_staff_id ON appraisal_cases(staff_id);
  CREATE INDEX idx_cases_manager_staff_id ON appraisal_cases(manager_staff_id_from_intake);
  CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
  CREATE INDEX idx_benchmarks_role_band ON market_benchmarks(staff_role, tenure_band_id);
  CREATE INDEX idx_overrides_employee_scope ON manager_overrides(employee_staff_id, scope, cycle_id);
  ```

- **Query Optimization**:
  - Eager load related data for list views to avoid N+1 queries
  - Use `SELECT` specific fields rather than `SELECT *` for large tables
  - Pagination with cursor-based approach for large result sets
  - Denormalize computed values (tenure_months, resolved_manager_staff_id) for filtering

#### 2. Upload Processing
- **Background Job**: Large uploads (700 rows) processed asynchronously
  - Accept upload → return batch_id immediately
  - Process rows in background worker
  - Poll endpoint for completion status
  - Websocket/SSE for real-time progress updates
- **Batch Operations**: Use Prisma batch inserts/updates for movement logs and row results
- **Validation Efficiency**: Parse CSV in streams rather than loading full file to memory

#### 3. API Response Times
- **Target Latencies**:
  - List endpoints: < 300ms (with pagination)
  - Detail endpoints: < 200ms
  - Mutations: < 500ms
  - Upload processing: 5-10 seconds for 700 rows
- **Caching Strategy**:
  - Cache tenure bands and market benchmarks (rare changes)
  - Cache field group permissions (rare changes)
  - Redis for session storage (fast lookups)
  - No caching of case data (real-time consistency required)

#### 4. Frontend Performance
- **Code Splitting**: Lazy load routes (React.lazy)
- **Virtualization**: Use react-virtual for large tables (700 rows)
- **Debouncing**: Filter inputs debounced 300ms
- **React Query**: Automatic stale-while-revalidate caching for read queries
- **Optimistic Updates**: Immediate UI feedback for mutations, rollback on error

#### 5. Scalability Path
- **Horizontal Scaling**: Stateless API servers behind load balancer
- **Database Scaling**: 
  - Connection pooling (Prisma connection limit)
  - Read replicas for dashboard queries (if needed)
  - Partitioning audit_events by year
- **File Storage**: S3-compatible storage with CDN for downloads

---

## Repository Structure

### Monorepo Organization

```
salary-appraisal-system/
├── apps/
│   ├── web/                      # React frontend
│   │   ├── public/
│   │   │   ├── index.html
│   │   │   └── favicon.ico
│   │   ├── src/
│   │   │   ├── components/       # Reusable UI components
│   │   │   │   ├── common/       # Buttons, Inputs, Modals
│   │   │   │   ├── layout/       # AppShell, TopNav, SideNav
│   │   │   │   ├── cases/        # Case-specific components
│   │   │   │   ├── cycles/       # Cycle management components
│   │   │   │   └── admin/        # Admin portal components
│   │   │   ├── pages/            # Route-level pages
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── DashboardPage.tsx
│   │   │   │   ├── CyclesPage.tsx
│   │   │   │   ├── ImportsPage.tsx
│   │   │   │   ├── CasesListPage.tsx
│   │   │   │   ├── CaseDetailPage.tsx
│   │   │   │   └── admin/
│   │   │   │       ├── MarketRulesPage.tsx
│   │   │   │       └── PermissionsPage.tsx
│   │   │   ├── hooks/            # Custom React hooks
│   │   │   ├── services/         # API client functions
│   │   │   ├── contexts/         # React Context providers
│   │   │   ├── utils/            # Helper functions
│   │   │   ├── types/            # TypeScript interfaces
│   │   │   ├── App.tsx
│   │   │   ├── index.tsx
│   │   │   └── routes.tsx
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                      # Node.js backend
│       ├── src/
│       │   ├── controllers/      # Request handlers
│       │   │   ├── authController.ts
│       │   │   ├── cycleController.ts
│       │   │   ├── caseController.ts
│       │   │   ├── uploadController.ts
│       │   │   ├── marketRulesController.ts
│       │   │   ├── exportController.ts
│       │   │   └── adminController.ts
│       │   ├── services/         # Business logic
│       │   │   ├── authService.ts
│       │   │   ├── otpService.ts
│       │   │   ├── caseService.ts
│       │   │   ├── uploadService.ts
│       │   │   ├── computationService.ts
│       │   │   ├── approvalService.ts
│       │   │   ├── checklistService.ts
│       │   │   ├── exportService.ts
│       │   │   ├── auditService.ts
│       │   │   └── notificationService.ts
│       │   ├── middleware/       # Express middleware
│       │   │   ├── authMiddleware.ts
│       │   │   ├── permissionMiddleware.ts
│       │   │   ├── validationMiddleware.ts
│       │   │   ├── rateLimitMiddleware.ts
│       │   │   └── errorHandler.ts
│       │   ├── validators/       # Request validation schemas
│       │   │   └── schemas/
│       │   ├── utils/            # Helper functions
│       │   │   ├── csvParser.ts
│       │   │   ├── excelGenerator.ts
│       │   │   ├── pdfGenerator.ts
│       │   │   └── tokenManager.ts
│       │   ├── config/           # Configuration
│       │   │   ├── database.ts
│       │   │   ├── email.ts
│       │   │   └── app.ts
│       │   ├── routes/           # Route definitions
│       │   │   ├── index.ts
│       │   │   ├── authRoutes.ts
│       │   │   ├── cycleRoutes.ts
│       │   │   ├── caseRoutes.ts
│       │   │   ├── uploadRoutes.ts
│       │   │   ├── marketRulesRoutes.ts
│       │   │   ├── exportRoutes.ts
│       │   │   └── adminRoutes.ts
│       │   ├── types/            # TypeScript types
│       │   ├── app.ts            # Express app setup
│       │   └── server.ts         # Server entry point
│       ├── prisma/
│       │   ├── schema.prisma     # Prisma schema
│       │   ├── migrations/       # Migration files
│       │   └── seed.ts           # Seed data script
│       ├── tests/
│       │   ├── unit/
│       │   └── integration/
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── database/                 # Shared Prisma client
│   │   ├── prisma/
│   │   │   └── schema.prisma    # (symlink to apps/api/prisma/schema.prisma)
│   │   ├── src/
│   │   │   └── client.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── shared/                   # Shared types and utilities
│       ├── src/
│       │   ├── types/            # Common TypeScript types
│       │   │   ├── api.ts
│       │   │   ├── case.ts
│       │   │   ├── cycle.ts
│       │   │   └── permissions.ts
│       │   └── constants/        # Shared constants
│       │       ├── roles.ts
│       │       ├── statuses.ts
│       │       └── flags.ts
│       ├── tsconfig.json
│       └── package.json
│
├── docs/
│   ├── SYSTEM_DESIGN.md         # This document
│   ├── DATABASE_SCHEMA.md       # Full Prisma schema with annotations
│   ├── API_CONTRACTS.md         # Complete API endpoint specifications
│   ├── BUSINESS_RULES.md        # Detailed algorithm documentation
│   ├── UI_ARCHITECTURE.md       # Component specs and design patterns
│   ├── SETUP_GUIDE.md           # Local development setup
│   ├── DEPLOYMENT_GUIDE.md      # Production deployment instructions
│   └── TESTING_STRATEGY.md      # Testing approach and standards
│
├── scripts/
│   ├── init-repo.sh             # Initial repository setup
│   ├── create-migration.sh      # Helper for Prisma migrations
│   ├── seed-dev-data.sh         # Populate development data
│   └── backup-db.sh             # Database backup script
│
├── .gitignore
├── .env.example
├── docker-compose.yml           # Local PostgreSQL + Redis
├── docker-compose.prod.yml      # Production-like local environment
├── package.json                 # Root workspace configuration
├── tsconfig.json                # Root TypeScript config
├── .eslintrc.js                 # Linting rules
├── .prettierrc                  # Code formatting
└── README.md                    # Project overview and quick start
```

### Environment Variables

**.env.example**:
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/salary_appraisal"

# API Server
NODE_ENV="development"
API_PORT=3001
API_BASE_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"

# JWT
JWT_SECRET="your-jwt-secret-change-in-production"
JWT_EXPIRY="15m"
REFRESH_TOKEN_SECRET="your-refresh-token-secret"
REFRESH_TOKEN_EXPIRY="7d"

# OTP
OTP_EXPIRY_MINUTES=10
OTP_MAX_ATTEMPTS=5

# Email (SendGrid)
SENDGRID_API_KEY="your-sendgrid-api-key"
EMAIL_FROM="noreply@yourcompany.com"
EMAIL_FROM_NAME="Salary Appraisal System"

# File Storage
STORAGE_TYPE="local"  # or "s3"
LOCAL_STORAGE_PATH="./uploads"
# S3_BUCKET="your-bucket-name"
# S3_REGION="us-east-1"
# S3_ACCESS_KEY_ID="your-access-key"
# S3_SECRET_ACCESS_KEY="your-secret-key"

# Rate Limiting
RATE_LIMIT_OTP_PER_EMAIL=5
RATE_LIMIT_OTP_PER_IP=10
RATE_LIMIT_WINDOW_HOURS=1

# Admin Settings
ALLOWED_EMAIL_DOMAINS="yourcompany.com,partner.com"
GLOBAL_DEFAULT_CATCHUP_PERCENT=75

# Redis (optional, for session/cache)
REDIS_URL="redis://localhost:6379"

# Logging
LOG_LEVEL="info"  # debug, info, warn, error
```

---

## Deployment Strategy

### Local Development Setup

See `SETUP_GUIDE.md` for detailed instructions.

**Quick Start**:
```bash
# 1. Start PostgreSQL and Redis
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run migrations
npm run prisma:migrate

# 5. Seed development data
npm run seed

# 6. Start API server (port 3001)
npm run dev:api

# 7. Start frontend (port 3000)
npm run dev:web
```

### Production Deployment

**Infrastructure Requirements**:
- **Web Server**: Node.js 18+ (API)
- **Frontend Hosting**: Any static host (Nginx, Vercel, Netlify)
- **Database**: PostgreSQL 14+ with connection pooling
- **Cache**: Redis 6+ (optional but recommended)
- **File Storage**: S3-compatible storage
- **Email**: SendGrid or AWS SES

**Deployment Steps**:
1. **Build frontend**: `npm run build:web` → static files in `apps/web/dist`
2. **Build API**: `npm run build:api` → compiled JS in `apps/api/dist`
3. **Run migrations**: `npm run prisma:migrate:deploy`
4. **Start API server**: `node apps/api/dist/server.js` with PM2 or systemd
5. **Deploy frontend**: Upload `apps/web/dist` to CDN/static host
6. **Configure reverse proxy**: Nginx for API routing and SSL termination

**Environment Checklist**:
- [ ] Set strong `JWT_SECRET` and `REFRESH_TOKEN_SECRET`
- [ ] Configure production `DATABASE_URL` with connection pooling
- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS for known frontend domains only
- [ ] Enable HTTPS (SSL certificates)
- [ ] Configure email service credentials
- [ ] Set up S3 bucket for file storage with private ACL
- [ ] Configure monitoring and error tracking (Sentry, Datadog)
- [ ] Set up database backups (daily minimum)
- [ ] Configure log aggregation

### Branching and Git Workflow

See `REPOSITORY_SETUP.md` for initialization commands.

**Branch Strategy**:
- **main**: Production-ready, tagged releases
- **develop**: Integration branch for features
- **feature/***: New features (`feature/market-rules-engine`)
- **bugfix/***: Non-critical fixes (`bugfix/otp-rate-limit`)
- **hotfix/***: Critical production fixes (`hotfix/seal-cycle-validation`)

**Commit Convention**:
```
type(scope): message

Types: feat, fix, docs, style, refactor, test, chore
Examples:
  feat(cases): add override approval evidence validation
  fix(upload): handle duplicate staff IDs correctly
  docs(api): update case status transition documentation
  refactor(computation): extract tenure band resolution logic
```

**Pull Request Process**:
1. Create feature branch from `develop`
2. Implement changes with tests
3. Open PR to `develop` with description and testing notes
4. Code review required (1+ approver)
5. CI checks must pass (linting, type checking, tests)
6. Merge via squash commit
7. Deploy `develop` to staging for QA
8. Merge `develop` to `main` for production release

---

## Documentation Index

This specification is supported by detailed documentation files:

1. **DATABASE_SCHEMA.md**: Complete Prisma schema with field descriptions, constraints, and index rationale
2. **API_CONTRACTS.md**: All endpoints with request/response examples, authentication requirements, and error scenarios
3. **BUSINESS_RULES.MD**: Detailed pseudocode for all algorithms including edge case handling
4. **UI_ARCHITECTURE.md**: Component specifications, prop interfaces, styling patterns, and interaction flows
5. **SETUP_GUIDE.md**: Step-by-step local development environment setup
6. **DEPLOYMENT_GUIDE.md**: Production deployment procedures and infrastructure requirements
7. **TESTING_STRATEGY.md**: Unit, integration, and E2E testing approach with example test cases
8. **REPOSITORY_SETUP.md**: Git initialization and GitHub repository creation instructions

---

## Next Steps for Development Team

### Phase 1: Foundation (Weeks 1-2)
1. Initialize repository structure from this specification
2. Implement Prisma schema and run initial migration
3. Set up API skeleton with middleware stack
4. Implement authentication (OTP + session management)
5. Create frontend shell with routing and layout components

### Phase 2: Core Entities (Weeks 3-5)
1. Implement Cycles CRUD and state transitions
2. Implement Cases CRUD with filtering and pagination
3. Build Intake Upload processing with movement logging
4. Implement Compensation Upload functionality
5. Create Case List and Case Detail pages

### Phase 3: Business Logic (Weeks 6-8)
1. Implement Market Rules engine with tenure bands and benchmarks
2. Build Recommendation computation service
3. Implement Manager Override resolution
4. Create Impact Preview functionality
5. Build Admin Market Rules Portal

### Phase 4: Workflow (Weeks 9-11)
1. Implement Approval evidence with file uploads and Drive links
2. Build Checklist workflow with role-based completion
3. Implement Case status transitions and locking
4. Create Effectivity date tracking
5. Build Case Detail tabs (Compensation, Approvals, Checklist, Audit)

### Phase 5: Permissions & Admin (Weeks 12-13)
1. Implement Field Group permissions system
2. Build Permission Middleware with dynamic checks
3. Create Admin Permissions Portal
4. Implement Manager visibility filtering
5. Build Audit Timeline views

### Phase 6: Exports & Polish (Weeks 14-15)
1. Implement Payroll export with all formats
2. Build Dashboard with metrics and charts
3. Implement Notification system
4. Create Questionable Data reports
5. Build Movement Log and Override reports

### Phase 7: Testing & Deployment (Weeks 16-17)
1. Write comprehensive unit tests for services
2. Write integration tests for API endpoints
3. Write E2E tests for critical user flows
4. Set up CI/CD pipeline
5. Deploy to staging and conduct UAT

### Phase 8: Production Launch (Week 18)
1. Conduct security audit
2. Performance testing with 700-case load
3. Train administrators and end users
4. Deploy to production
5. Monitor and address any launch issues

---

**End of System Design Specification**

For detailed technical specifications, refer to the companion documentation files listed in the Documentation Index section.
