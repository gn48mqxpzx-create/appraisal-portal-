# Employee Directory Implementation - Deliverables

## Overview
Built a core employee directory database synced from HubSpot, with query logic for SM and RM views. Only active staff members are included.

---

## PART 1: Database Schema Changes

### New Table: `employee_directory`

**Migration File:** `20260306000000_add_employee_directory`

**Schema Definition:**
```prisma
model EmployeeDirectory {
  id                   String   @id @default(uuid())
  hubspotContactId     String   @unique  // HubSpot contact ID
  staffId              String   @unique  // Unique staff ID number
  fullName             String
  email                String
  contactType          String   // "Staff Member - Active" (filtered on sync)
  staffRole            String
  smName               String?  // Success Manager name
  rmName               String?  // Relationship Manager name
  staffStartDate       DateTime?
  
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  
  // Indexes for fast lookups
  @@index([staffId])
  @@index([email])
  @@index([contactType])
  @@index([staffRole])
  @@index([smName])
  @@index([rmName])
  @@map("employee_directory")
}
```

**SQL Migration:**
```sql
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

CREATE UNIQUE INDEX "employee_directory_hubspotContactId_key" ON "employee_directory"("hubspotContactId");
CREATE UNIQUE INDEX "employee_directory_staffId_key" ON "employee_directory"("staffId");
CREATE INDEX "employee_directory_email_idx" ON "employee_directory"("email");
CREATE INDEX "employee_directory_contactType_idx" ON "employee_directory"("contactType");
CREATE INDEX "employee_directory_staffRole_idx" ON "employee_directory"("staffRole");
CREATE INDEX "employee_directory_smName_idx" ON "employee_directory"("smName");
CREATE INDEX "employee_directory_rmName_idx" ON "employee_directory"("rmName");
```

---

## PART 2: HubSpot Sync Service

**File:** `apps/api/src/services/employeeDirectoryService.ts`

**Key Functions:**

1. **`syncEmployeeDirectory()`** - Main sync function
   - Fetches all contacts from HubSpot where `contact_type = "Staff Member - Active"`
   - Maps HubSpot properties to employee_directory fields
   - Creates or updates records in the database
   - Returns: `{ synced, created, updated, errors }`

2. **`getEmployeesUnderSM(smName)`** - Get VAs under a specific SM
   - Returns all active staff where `smName = :smName` and `staffRole ≠ "Success Manager"`

3. **`getActiveSMsUnderRM(rmName)`** - Get SMs under a specific RM
   - Returns all SMs where `rmName = :rmName` and `staffRole = "Success Manager"`

4. **`getVAsUnderSMs(smNames)`** - Get VAs grouped by their SMs
   - Returns all active VAs that belong to the given SM names

5. **`getEmployeeByStaffId(staffId)`** - Lookup by staff ID
6. **`getEmployeeByEmail(email)`** - Lookup by email

**HubSpot Property Mapping:**
```
HubSpot Field             → Database Field
id                        → hubspotContactId
staff_id_number           → staffId
firstname + lastname      → fullName
email                     → email
contact_type              → contactType (filtered: "Staff Member - Active" only)
staff_role                → staffRole
sm                        → smName
senior_success_manager    → rmName
staff_start_date          → staffStartDate
```

---

## PART 3: API Endpoints

### New Routes File: `apps/api/src/directoryRoutes.ts`

**Base Path:** `/directory`

#### 1. `GET /directory/sm/:smName`
**Purpose:** Get all active VAs under a specific SM (Success Manager)

**Query Parameters:**
- `:smName` (required, URL-encoded) - The SM name to filter by (e.g., "Vanessa Dinopol")

**Response:**
```json
{
  "viewer_type": "SM",
  "sm_name": "Vanessa Dinopol",
  "total_va_count": 5,
  "vas": [
    {
      "id": "uuid-1",
      "hubspotContactId": "hubspot-123",
      "staffId": "VA001",
      "fullName": "John Doe",
      "email": "john@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Virtual Assistant",
      "smName": "Vanessa Dinopol",
      "rmName": "Uly Catalan",
      "staffStartDate": "2022-01-15T00:00:00.000Z"
    },
    {
      "id": "uuid-2",
      "hubspotContactId": "hubspot-124",
      "staffId": "VA002",
      "fullName": "Jane Smith",
      "email": "jane@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Virtual Assistant",
      "smName": "Vanessa Dinopol",
      "rmName": "Uly Catalan",
      "staffStartDate": "2023-03-20T00:00:00.000Z"
    }
  ]
}
```

---

#### 2. `GET /directory/rm/:rmName`
**Purpose:** Get all active SMs and VAs under a specific RM (Relationship Manager)

**Query Parameters:**
- `:rmName` (required, URL-encoded) - The RM name to filter by (e.g., "Uly Catalan")

**Response:**
```json
{
  "viewer_type": "RM",
  "rm_name": "Uly Catalan",
  "total_sm_count": 2,
  "total_va_count": 8,
  "active_sms": [
    {
      "id": "uuid-10",
      "hubspotContactId": "hubspot-500",
      "staffId": "SM001",
      "fullName": "Vanessa Dinopol",
      "email": "vanessa@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Success Manager",
      "smName": "Vanessa Dinopol",
      "rmName": "Uly Catalan",
      "staffStartDate": "2020-06-01T00:00:00.000Z"
    },
    {
      "id": "uuid-11",
      "hubspotContactId": "hubspot-501",
      "staffId": "SM002",
      "fullName": "Alex Turner",
      "email": "alex@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Success Manager",
      "smName": "Alex Turner",
      "rmName": "Uly Catalan",
      "staffStartDate": "2021-02-10T00:00:00.000Z"
    }
  ],
  "active_vas": [
    {
      "id": "uuid-20",
      "hubspotContactId": "hubspot-600",
      "staffId": "VA001",
      "fullName": "John Doe",
      "email": "john@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Virtual Assistant",
      "smName": "Vanessa Dinopol",
      "rmName": "Uly Catalan",
      "staffStartDate": "2022-01-15T00:00:00.000Z"
    },
    {
      "id": "uuid-21",
      "hubspotContactId": "hubspot-601",
      "staffId": "VA002",
      "fullName": "Jane Smith",
      "email": "jane@company.com",
      "contactType": "Staff Member - Active",
      "staffRole": "Virtual Assistant",
      "smName": "Vanessa Dinopol",
      "rmName": "Uly Catalan",
      "staffStartDate": "2023-03-20T00:00:00.000Z"
    }
  ],
  "va_groups_by_sm": [
    {
      "sm_name": "Alex Turner",
      "va_count": 3,
      "vas": [
        {
          "id": "uuid-30",
          "hubspotContactId": "hubspot-700",
          "staffId": "VA003",
          "fullName": "Carlos Rodriguez",
          "email": "carlos@company.com",
          "contactType": "Staff Member - Active",
          "staffRole": "Virtual Assistant",
          "smName": "Alex Turner",
          "rmName": "Uly Catalan",
          "staffStartDate": "2023-05-10T00:00:00.000Z"
        }
      ]
    },
    {
      "sm_name": "Vanessa Dinopol",
      "va_count": 5,
      "vas": [
        {
          "id": "uuid-20",
          "hubspotContactId": "hubspot-600",
          "staffId": "VA001",
          "fullName": "John Doe",
          "email": "john@company.com",
          "contactType": "Staff Member - Active",
          "staffRole": "Virtual Assistant",
          "smName": "Vanessa Dinopol",
          "rmName": "Uly Catalan",
          "staffStartDate": "2022-01-15T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

#### 3. `GET /directory/employee/:staffId`
**Purpose:** Get a single employee by staff ID

**Response:**
```json
{
  "id": "uuid-1",
  "hubspotContactId": "hubspot-123",
  "staffId": "VA001",
  "fullName": "John Doe",
  "email": "john@company.com",
  "contactType": "Staff Member - Active",
  "staffRole": "Virtual Assistant",
  "smName": "Vanessa Dinopol",
  "rmName": "Uly Catalan",
  "staffStartDate": "2022-01-15T00:00:00.000Z",
  "createdAt": "2026-03-06T08:00:00.000Z",
  "updatedAt": "2026-03-06T08:00:00.000Z"
}
```

---

#### 4. `GET /directory/employee-by-email/:email`
**Purpose:** Get a single employee by email

**Response:** Same as `/directory/employee/:staffId`

---

#### 5. `POST /directory/sync`
**Purpose:** Trigger a sync of employee directory from HubSpot

**Note:** In production, this should be protected with admin authentication.

**Response:**
```json
{
  "success": true,
  "synced": 150,
  "created": 45,
  "updated": 105,
  "errors": [
    {
      "staffId": "INVALID001",
      "error": "Missing staffId or email"
    }
  ],
  "timestamp": "2026-03-06T08:30:00.000Z"
}
```

---

## PART 4: Business Rules Enforced

✓ Only includes contacts where `contact_type = "Staff Member - Active"`
✓ Does NOT include separated staff
✓ Does NOT include Ops Staff
✓ Does NOT include Leads or Clients
✓ SM logic: Show all active VAs where `smName` matches that SM
✓ RM logic: 
  - First find all active SMs under that RM (by `rmName`)
  - Then find all active VAs under those SMs (by `smName`)
  - Return both lists and grouped output

---

## PART 5: Implementation Summary

### Files Created:
1. **`packages/database/prisma/schema.prisma`** - Added EmployeeDirectory model
2. **`packages/database/prisma/migrations/20260306000000_add_employee_directory/migration.sql`** - Migration file
3. **`apps/api/src/services/employeeDirectoryService.ts`** - Sync service and query helpers
4. **`apps/api/src/directoryRoutes.ts`** - API endpoints

### Files Updated:
1. **`apps/api/src/index.ts`** - Imported and registered directoryRoutes

### Changes Are:
- **Minimal and focused** on employee directory functionality
- **Database-backed** (no direct HubSpot calls for directory queries)
- **Performant** with proper indexes on frequently queried fields
- **Separate from existing scope routes** - No changes to existing /scope endpoints

---

## Setup Instructions

1. **Apply Migration:**
   ```bash
   cd packages/database
   npm run prisma:migrate:dev
   ```

2. **Trigger Initial Sync:**
   ```bash
   curl -X POST http://localhost:3001/directory/sync
   ```

3. **Query Directory:**
   ```bash
   # Get VAs under a specific SM
   curl http://localhost:3001/directory/sm/Vanessa%20Dinopol

   # Get SMs and VAs under a specific RM
   curl http://localhost:3001/directory/rm/Uly%20Catalan

   # Get single employee by staff ID
   curl http://localhost:3001/directory/employee/VA001

   # Get single employee by email
   curl http://localhost:3001/directory/employee-by-email/john@company.com
   ```

---
