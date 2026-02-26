# API Contracts Documentation
## Salary Appraisal Workflow System

### Version: 1.0
### Date: February 26, 2026

---

## Base URL

```
Development: http://localhost:3001/api
Production: https://api.yourcompany.com/api
```

## Authentication

All endpoints except `/auth/request-otp` and `/auth/verify-otp` require authentication.

**Authentication Header**:
```
Authorization: Bearer <access_token>
```

**Token Refresh**:
Access tokens expire after 15 minutes. Use refresh token to obtain new access token.

---

## Standard Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-02-26T10:30:00Z",
    "requestId": "uuid"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... }
  },
  "meta": {
    "timestamp": "2026-02-26T10:30:00Z",
    "requestId": "uuid"
  }
}
```

### Paginated Response
```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 683,
      "totalPages": 14,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

---

## HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful GET, PUT, PATCH requests |
| 201 | Created | Successful POST request creating a resource |
| 204 | No Content | Successful DELETE request |
| 400 | Bad Request | Invalid request body or parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Authenticated but insufficient permissions |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Resource conflict (e.g., cycle already sealed) |
| 422 | Unprocessable Entity | Validation errors |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side error |

---

## 1. Authentication Endpoints

### POST /auth/request-otp

Request OTP code sent to email.

**Request Body**:
```json
{
  "email": "user@yourcompany.com"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "message": "OTP code sent to user@yourcompany.com",
    "expiresIn": 600
  }
}
```

**Error Responses**:
- 400: Invalid email format
- 403: Email domain not whitelisted
- 429: Rate limit exceeded (5 requests per email per hour, 10 per IP per hour)

**Rate Limits**:
- 5 requests per email per hour
- 10 requests per IP per hour

---

### POST /auth/verify-otp

Verify OTP code and create session.

**Request Body**:
```json
{
  "email": "user@yourcompany.com",
  "code": "123456"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900,
    "user": {
      "id": "uuid",
      "email": "user@yourcompany.com",
      "fullName": "John Doe",
      "staffId": "12345",
      "roles": ["HR", "MANAGER"]
    }
  }
}
```

**Error Responses**:
- 400: Invalid request body
- 401: Invalid OTP code
- 401: OTP expired
- 429: Too many failed attempts (5 per email)

---

### POST /auth/refresh

Refresh access token using refresh token.

**Request Body**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

**Error Responses**:
- 401: Invalid or expired refresh token

---

### POST /auth/logout

Invalidate current session.

**Headers**: `Authorization: Bearer <token>`

**Success Response** (204): No content

---

### GET /auth/me

Get current user profile.

**Headers**: `Authorization: Bearer <token>`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@yourcompany.com",
    "fullName": "John Doe",
    "staffId": "12345",
    "roles": ["HR", "MANAGER"],
    "permissions": {
      "fieldGroups": [
        {
          "name": "Current Compensation",
          "canView": true,
          "canEdit": true
        }
      ]
    },
    "lastLoginAt": "2026-02-26T09:15:00Z"
  }
}
```

---

## 2. Cycle Endpoints

### GET /cycles

List all cycles with optional filtering.

**Query Parameters**:
- `type`: Filter by cycle type (ANNUAL_AU_FY, ANNIVERSARY)
- `isActive`: Filter by active status (true/false)
- `sealed`: Filter by sealed status (true/false)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `sort`: Sort field and direction (e.g., `startDate:desc`)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Annual AU FY 2026",
        "type": "ANNUAL_AU_FY",
        "startDate": "2026-01-01T00:00:00Z",
        "isActive": true,
        "importsLocked": false,
        "sealed": false,
        "createdAt": "2026-01-05T10:00:00Z",
        "createdBy": {
          "id": "uuid",
          "fullName": "Admin User"
        },
        "stats": {
          "totalCases": 683,
          "inScope": 666,
          "removed": 17,
          "approved": 412,
          "releasedToPayroll": 203
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

---

### GET /cycles/:id

Get cycle details by ID.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Annual AU FY 2026",
    "type": "ANNUAL_AU_FY",
    "startDate": "2026-01-01T00:00:00Z",
    "isActive": true,
    "importsLocked": false,
    "importsLockedAt": null,
    "importsLockedBy": null,
    "sealed": false,
    "sealedAt": null,
    "sealedBy": null,
    "createdAt": "2026-01-05T10:00:00Z",
    "updatedAt": "2026-01-05T10:00:00Z",
    "createdBy": {
      "id": "uuid",
      "fullName": "Admin User"
    },
    "stats": {
      "totalCases": 683,
      "byStatus": {
        "DRAFT": 58,
        "IN_REVIEW": 124,
        "BLOCKED": 8,
        "APPROVED": 412,
        "RELEASED_TO_PAYROLL": 203,
        "REMOVED_FROM_SCOPE": 17
      },
      "missingBenchmark": 12,
      "hasOverride": 45,
      "missingApprovalEvidence": 3
    }
  }
}
```

**Error Responses**:
- 404: Cycle not found

---

### POST /cycles

Create new cycle. Requires ADMIN role.

**Request Body**:
```json
{
  "name": "Annual AU FY 2026",
  "type": "ANNUAL_AU_FY",
  "startDate": "2026-01-01T00:00:00Z"
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Annual AU FY 2026",
    "type": "ANNUAL_AU_FY",
    "startDate": "2026-01-01T00:00:00Z",
    "isActive": false,
    "importsLocked": false,
    "sealed": false,
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 400: Invalid request body
- 403: Insufficient permissions
- 422: Validation errors (e.g., invalid date format)

---

### PATCH /cycles/:id/activate

Activate cycle. Only one cycle per type can be active. Requires ADMIN role.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "isActive": true
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Another cycle of same type already active

---

### PATCH /cycles/:id/lock-imports

Lock imports for cycle. Prevents further intake uploads. Requires ADMIN role.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "importsLocked": true,
    "importsLockedAt": "2026-02-26T10:30:00Z",
    "importsLockedBy": "uuid"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Imports already locked

---

### PATCH /cycles/:id/seal

Seal cycle permanently. Makes all cycle data read-only. Requires ADMIN role.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "sealed": true,
    "sealedAt": "2026-02-26T10:30:00Z",
    "sealedBy": "uuid"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Cycle not ready for sealing (imports not locked, incomplete cases)
- 422: Validation errors (e.g., "12 cases still in DRAFT status")

---

### DELETE /cycles/:id

Delete cycle (soft delete). Only allowed if no cases exist. Requires ADMIN role.

**Success Response** (204): No content

**Error Responses**:
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Cannot delete cycle with existing cases

---

## 3. Case Endpoints

### GET /cases

List appraisal cases with advanced filtering and pagination.

**Query Parameters**:
- `cycleId`: Filter by cycle (required unless user has global view permission)
- `status`: Comma-separated statuses (e.g., `DRAFT,IN_REVIEW`)
- `company`: Filter by company name (partial match)
- `staffRole`: Filter by staff role
- `successManagerStaffId`: Filter by SM
- `relationshipManagerStaffId`: Filter by RM
- `resolvedManagerStaffId`: Filter by manager (auto-applied for MANAGER role)
- `isMissingBenchmark`: Filter missing benchmarks (true/false)
- `hasOverride`: Filter override cases (true/false)
- `isRemoved`: Filter removed cases (true/false)
- `search`: Search by staff ID or full name (partial match)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 50, max: 200)
- `sort`: Sort field and direction (e.g., `fullName:asc`, `status:desc`)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "cycleId": "uuid",
        "staffId": "12345",
        "fullName": "Jane Smith",
        "contactType": "Full-time",
        "companyName": "Acme Corp",
        "staffRole": "Senior Engineer",
        "startDate": "2023-06-15T00:00:00Z",
        "tenureMonths": 32,
        "status": "IN_REVIEW",
        "effectivityDate": "2026-04-01T00:00:00Z",
        "effectivityStatus": "PENDING_EFFECTIVITY",
        "isMissingBenchmark": false,
        "hasOverride": false,
        "resolvedManagerStaffId": "98765",
        "compensation": {
          "currentBaseSalary": 85000.00,
          "recommendedNewBase": 92000.00,
          "approvedNewBaseSalary": 92000.00
        },
        "checklist": {
          "totalItems": 5,
          "completedItems": 3,
          "progress": 60
        },
        "updatedAt": "2026-02-25T14:20:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 683,
      "totalPages": 14
    }
  }
}
```

**Permissions**:
- MANAGER role: Automatically filtered to cases where `resolvedManagerStaffId = user.staffId`
- HR, FINANCE, PAYROLL, ADMIN: Can view all cases

---

### GET /cases/:id

Get detailed case information.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "cycleId": "uuid",
    "cycle": {
      "id": "uuid",
      "name": "Annual AU FY 2026",
      "sealed": false
    },
    "staffId": "12345",
    "fullName": "Jane Smith",
    "contactType": "Full-time",
    "companyName": "Acme Corp",
    "staffRole": "Senior Engineer",
    "startDate": "2023-06-15T00:00:00Z",
    "tenureMonths": 32,
    "tenureDisplay": "2 years 8 months",
    "successManagerStaffId": "11111",
    "relationshipManagerStaffId": "22222",
    "managerStaffIdFromIntake": "98765",
    "resolvedManagerStaffId": "98765",
    "managerOverrideApplied": false,
    "status": "IN_REVIEW",
    "previousStatus": "DRAFT",
    "effectivityDate": "2026-04-01T00:00:00Z",
    "effectivityStatus": "PENDING_EFFECTIVITY",
    "lockedAt": null,
    "lockedBy": null,
    "isMissingBenchmark": false,
    "hasOverride": false,
    "hasMissingApprovalEvidence": false,
    "compensation": {
      "current": {
        "baseSalary": 85000.00,
        "fixedAllowances": 2400.00,
        "variableAllowances": 1200.00,
        "recurringBonuses": 8500.00,
        "onetimeBonuses": 5000.00,
        "totalCompensation": 97100.00
      },
      "recommendation": {
        "benchmarkUsed": 95000.00,
        "catchupPercentUsed": 75,
        "tenureMonthsUsed": 32,
        "varianceAmount": 10000.00,
        "variancePercent": 0.1176,
        "recommendedIncreaseAmount": 7500.00,
        "recommendedNewBase": 92500.00,
        "recommendedAdjustmentPercent": 0.0882,
        "message": null
      },
      "approved": {
        "newBaseSalary": 92000.00,
        "fixedAllowances": 2400.00,
        "variableAllowances": 1200.00,
        "recurringBonuses": 8500.00,
        "totalCompensation": 104100.00,
        "amountDifference": 7000.00,
        "percentDifference": 0.0824
      },
      "override": {
        "isOverride": false,
        "reason": null,
        "approvedBy": null,
        "approvedAt": null
      }
    },
    "approvals": [
      {
        "id": "uuid",
        "approvalType": "EMAIL",
        "status": "VERIFIED",
        "approvalDate": "2026-02-20T00:00:00Z",
        "approvedByName": "Client Manager",
        "notes": "Approved via email chain",
        "attachments": [
          {
            "id": "uuid",
            "attachmentType": "UPLOAD",
            "fileName": "approval_email.pdf",
            "fileSize": 245678,
            "downloadUrl": "/api/approvals/uuid/attachments/uuid/download"
          }
        ],
        "createdAt": "2026-02-20T10:15:00Z"
      }
    ],
    "checklist": [
      {
        "id": "uuid",
        "itemKey": "HR_REVIEW",
        "label": "HR Review Completed",
        "assignedRole": "HR",
        "completed": true,
        "completedBy": {
          "id": "uuid",
          "fullName": "HR User"
        },
        "completedAt": "2026-02-22T11:30:00Z"
      },
      {
        "itemKey": "MANAGER_REVIEW",
        "label": "Manager Review",
        "assignedRole": "MANAGER",
        "completed": true,
        "completedBy": {
          "id": "uuid",
          "fullName": "Manager User"
        },
        "completedAt": "2026-02-23T14:15:00Z"
      },
      {
        "itemKey": "FINANCE_APPROVAL",
        "label": "Finance Approval",
        "assignedRole": "FINANCE",
        "completed": false,
        "completedBy": null,
        "completedAt": null
      }
    ],
    "movementLogs": [
      {
        "id": "uuid",
        "movementType": "ADDED",
        "timestamp": "2026-01-10T08:00:00Z"
      },
      {
        "movementType": "FIELD_CHANGE",
        "fieldName": "manager_staff_id",
        "oldValue": "88888",
        "newValue": "98765",
        "timestamp": "2026-01-15T10:30:00Z"
      }
    ],
    "createdAt": "2026-01-10T08:00:00Z",
    "updatedAt": "2026-02-25T14:20:00Z"
  }
}
```

**Error Responses**:
- 403: User does not have permission to view this case
- 404: Case not found

---

### PATCH /cases/:id

Update case fields. Permissions checked based on field groups and role.

**Request Body**:
```json
{
  "status": "APPROVED",
  "effectivityDate": "2026-04-01T00:00:00Z"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "APPROVED",
    "effectivityDate": "2026-04-01T00:00:00Z",
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions to edit these fields
- 404: Case not found
- 409: Case is locked (released to payroll or cycle sealed)
- 422: Validation errors

---

### POST /cases/:id/compute-recommendation

Compute or recompute market recommendation for case.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "benchmarkUsed": 95000.00,
    "catchupPercentUsed": 75,
    "tenureMonthsUsed": 32,
    "varianceAmount": 10000.00,
    "variancePercent": 0.1176,
    "recommendedIncreaseAmount": 7500.00,
    "recommendedNewBase": 92500.00,
    "recommendedAdjustmentPercent": 0.0882,
    "message": null
  }
}
```

**Error Responses**:
- 404: Case not found
- 409: Case is locked or cycle sealed
- 422: Missing benchmark data (returns `isMissingBenchmark: true`)

---

## 4. Compensation Endpoints

### PATCH /cases/:id/compensation

Update case compensation fields. Checks field-group permissions.

**Request Body**:
```json
{
  "currentBaseSalary": 85000.00,
  "currentFixedAllowances": 2400.00,
  "currentVariableAllowances": 1200.00,
  "currentRecurringBonuses": 8500.00,
  "currentOnetimeBonuses": 5000.00
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "currentBaseSalary": 85000.00,
    "currentFixedAllowances": 2400.00,
    "currentVariableAllowances": 1200.00,
    "currentRecurringBonuses": 8500.00,
    "currentOnetimeBonuses": 5000.00,
    "currentTotalCompensation": 97100.00,
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Case not found
- 409: Case is locked
- 422: Validation errors (e.g., negative values)

---

### PATCH /cases/:id/compensation/approved

Update approved compensation values.

**Request Body**:
```json
{
  "approvedNewBaseSalary": 92000.00,
  "approvedFixedAllowances": 2400.00,
  "approvedVariableAllowances": 1200.00,
  "approvedRecurringBonuses": 8500.00
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "approvedNewBaseSalary": 92000.00,
    "approvedFixedAllowances": 2400.00,
    "approvedVariableAllowances": 1200.00,
    "approvedRecurringBonuses": 8500.00,
    "approvedTotalCompensation": 104100.00,
    "approvedAmountDifference": 7000.00,
    "approvedPercentDifference": 0.0824,
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### POST /cases/:id/compensation/override

Enable override and set override reason.

**Request Body**:
```json
{
  "isOverride": true,
  "overrideReason": "Client requested higher adjustment due to market competitiveness",
  "approvedNewBaseSalary": 95000.00
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "isOverride": true,
    "overrideReason": "Client requested higher adjustment...",
    "approvedNewBaseSalary": 95000.00,
    "overrideApprovedBy": "uuid",
    "overrideApprovedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Case not found
- 409: Case is locked
- 422: Missing required fields (reason, approvedNewBaseSalary)

---

## 5. Approval Endpoints

### POST /cases/:id/approvals

Create approval record for case.

**Request Body**:
```json
{
  "approvalType": "EMAIL",
  "status": "RECEIVED",
  "approvalDate": "2026-02-20T00:00:00Z",
  "approvedByName": "Client Manager",
  "notes": "Approved via email chain"
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "caseId": "uuid",
    "approvalType": "EMAIL",
    "status": "RECEIVED",
    "approvalDate": "2026-02-20T00:00:00Z",
    "approvedByName": "Client Manager",
    "notes": "Approved via email chain",
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### POST /approvals/:approvalId/attachments/upload

Upload PDF file as approval evidence.

**Request**: `multipart/form-data`
- `file`: PDF file (max 10MB)
- `fileName`: Optional custom file name

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "approvalId": "uuid",
    "attachmentType": "UPLOAD",
    "fileName": "approval_email.pdf",
    "fileSize": 245678,
    "mimeType": "application/pdf",
    "downloadUrl": "/api/approvals/uuid/attachments/uuid/download",
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 400: Invalid file type (only PDF allowed)
- 400: File size exceeds 10MB
- 404: Approval not found
- 409: Cycle is sealed

---

### POST /approvals/:approvalId/attachments/drive-link

Add Google Drive link as approval evidence.

**Request Body**:
```json
{
  "driveUrl": "https://drive.google.com/file/d/1a2b3c4d5e6f7/view"
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "approvalId": "uuid",
    "attachmentType": "DRIVE_LINK",
    "driveUrl": "https://drive.google.com/file/d/1a2b3c4d5e6f7/view",
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### GET /approvals/:approvalId/attachments/:attachmentId/download

Download approval attachment file (PDF). Returns signed URL or file stream.

**Success Response** (200):
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="approval_email.pdf"`
- Body: PDF file stream

**Error Responses**:
- 403: Insufficient permissions
- 404: Attachment not found or is DRIVE_LINK type

---

### PATCH /approvals/:approvalId

Update approval status and metadata.

**Request Body**:
```json
{
  "status": "VERIFIED",
  "notes": "Verified by Finance team"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "VERIFIED",
    "notes": "Verified by Finance team",
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### DELETE /approvals/:approvalId/attachments/:attachmentId

Delete approval attachment. Only allowed if cycle not sealed.

**Success Response** (204): No content

**Error Responses**:
- 403: Insufficient permissions
- 404: Attachment not found
- 409: Cycle is sealed

---

## 6. Checklist Endpoints

### GET /cases/:id/checklist

Get checklist items for case.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "itemKey": "HR_REVIEW",
        "label": "HR Review Completed",
        "assignedRole": "HR",
        "completed": true,
        "completedBy": {
          "id": "uuid",
          "fullName": "HR User",
          "email": "hr@yourcompany.com"
        },
        "completedAt": "2026-02-22T11:30:00Z"
      },
      {
        "itemKey": "FINANCE_APPROVAL",
        "label": "Finance Approval",
        "assignedRole": "FINANCE",
        "completed": false,
        "completedBy": null,
        "completedAt": null
      }
    ],
    "progress": {
      "total": 5,
      "completed": 3,
      "percentage": 60
    }
  }
}
```

---

### POST /cases/:id/checklist/:itemKey/complete

Mark checklist item as complete. Only user with assigned role can complete.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "itemKey": "FINANCE_APPROVAL",
    "completed": true,
    "completedBy": {
      "id": "uuid",
      "fullName": "Finance User"
    },
    "completedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: User role not assigned to this checklist item
- 404: Case or checklist item not found
- 409: Item already completed
- 409: Cycle is sealed
- 422: Preconditions not met (e.g., missing approval evidence for Finance item)

---

## 7. Upload Endpoints

### POST /uploads/intake

Upload intake spreadsheet (CSV/Excel). Creates upload batch and processes rows asynchronously.

**Request**: `multipart/form-data`
- `file`: CSV or Excel file
- `cycleId`: Target cycle ID

**Success Response** (202 Accepted):
```json
{
  "success": true,
  "data": {
    "batchId": "uuid",
    "cycleId": "uuid",
    "fileName": "intake_feb2026.xlsx",
    "uploadType": "INTAKE",
    "totalRows": 700,
    "processingStatus": "PROCESSING",
    "uploadedBy": {
      "id": "uuid",
      "fullName": "HR User"
    },
    "uploadedAt": "2026-02-26T10:30:00Z",
    "statusUrl": "/api/uploads/batches/uuid"
  }
}
```

**Error Responses**:
- 400: Invalid file format
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Cycle imports are locked
- 422: File validation errors (empty file, missing required columns)

---

### POST /uploads/compensation

Upload compensation data spreadsheet. Updates compensation fields only, does not change cycle scope.

**Request**: `multipart/form-data`
- `file`: CSV or Excel file
- `cycleId`: Target cycle ID

**Success Response** (202 Accepted):
```json
{
  "success": true,
  "data": {
    "batchId": "uuid",
    "cycleId": "uuid",
    "fileName": "compensation_feb2026.xlsx",
    "uploadType": "COMPENSATION",
    "totalRows": 683,
    "processingStatus": "PROCESSING",
    "uploadedAt": "2026-02-26T10:30:00Z",
    "statusUrl": "/api/uploads/batches/uuid"
  }
}
```

---

### GET /uploads/batches/:batchId

Get upload batch status and summary.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "cycleId": "uuid",
    "uploadType": "INTAKE",
    "fileName": "intake_feb2026.xlsx",
    "uploadedBy": {
      "id": "uuid",
      "fullName": "HR User"
    },
    "uploadedAt": "2026-02-26T10:30:00Z",
    "totalRows": 700,
    "processingStatus": "COMPLETED",
    "processedAt": "2026-02-26T10:32:15Z",
    "results": {
      "importedCount": 683,
      "flaggedCount": 14,
      "errorCount": 3,
      "addedCount": 17,
      "removedCount": 12,
      "readdedCount": 3,
      "updatedCount": 651
    },
    "questionableReportUrl": "/api/uploads/batches/uuid/questionable-report"
  }
}
```

---

### GET /uploads/batches/:batchId/questionable-report

Download questionable data report (CSV) showing flagged and error rows.

**Success Response** (200):
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="questionable_report_batch_uuid.csv"`
- Body: CSV file with columns:
  - Row Number
  - Staff ID
  - Full Name
  - Status
  - Flags
  - Error Message
  - Raw Data

---

### GET /uploads/batches

List upload batches with filtering.

**Query Parameters**:
- `cycleId`: Filter by cycle
- `uploadType`: Filter by type (INTAKE, COMPENSATION)
- `processingStatus`: Filter by status
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "cycleId": "uuid",
        "uploadType": "INTAKE",
        "fileName": "intake_feb2026.xlsx",
        "uploadedBy": {
          "fullName": "HR User"
        },
        "uploadedAt": "2026-02-26T10:30:00Z",
        "totalRows": 700,
        "processingStatus": "COMPLETED",
        "results": {
          "importedCount": 683,
          "flaggedCount": 14,
          "errorCount": 3
        }
      }
    ],
    "pagination": { ... }
  }
}
```

---

## 8. Market Rules Endpoints

### GET /market-rules/tenure-bands

List all tenure bands.

**Success Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "0-6 months",
      "minMonths": 0,
      "maxMonths": 6,
      "benchmarkCount": 15
    },
    {
      "id": "uuid",
      "name": "6-12 months",
      "minMonths": 7,
      "maxMonths": 12,
      "benchmarkCount": 15
    }
  ]
}
```

---

### POST /market-rules/tenure-bands

Create new tenure band. Requires ADMIN role.

**Request Body**:
```json
{
  "name": "2-5 years",
  "minMonths": 25,
  "maxMonths": 60
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "2-5 years",
    "minMonths": 25,
    "maxMonths": 60,
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 422: Validation errors (e.g., overlapping ranges, maxMonths <= minMonths)

---

### GET /market-rules/benchmarks

List market benchmarks with filtering.

**Query Parameters**:
- `staffRole`: Filter by role
- `tenureBandId`: Filter by tenure band
- `isActive`: Filter active benchmarks
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "staffRole": "Senior Engineer",
        "tenureBand": {
          "id": "uuid",
          "name": "2-5 years"
        },
        "baseSalary": 95000.00,
        "catchupPercent": 75,
        "isActive": true,
        "updatedAt": "2026-01-15T10:00:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

---

### POST /market-rules/benchmarks

Create market benchmark. Requires ADMIN role.

**Request Body**:
```json
{
  "staffRole": "Senior Engineer",
  "tenureBandId": "uuid",
  "baseSalary": 95000.00,
  "catchupPercent": 75
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "staffRole": "Senior Engineer",
    "tenureBandId": "uuid",
    "baseSalary": 95000.00,
    "catchupPercent": 75,
    "isActive": true,
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 409: Benchmark already exists for this role + tenure band combination
- 422: Validation errors

---

### PATCH /market-rules/benchmarks/:id

Update market benchmark.

**Request Body**:
```json
{
  "baseSalary": 98000.00,
  "catchupPercent": 80
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "baseSalary": 98000.00,
    "catchupPercent": 80,
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### POST /market-rules/preview-impact

Preview impact of market rules changes on cycle. Requires ADMIN role.

**Request Body**:
```json
{
  "cycleId": "uuid",
  "proposedChanges": {
    "benchmarks": [
      {
        "staffRole": "Senior Engineer",
        "tenureBandId": "uuid",
        "baseSalary": 100000.00,
        "catchupPercent": 85
      }
    ],
    "defaultCatchupPercent": 80
  }
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "cycleId": "uuid",
    "cycleName": "Annual AU FY 2026",
    "affectedCasesCount": 124,
    "currentTotalIncrease": 5427800.00,
    "proposedTotalIncrease": 6134500.00,
    "totalDelta": 706700.00,
    "percentChange": 13.02,
    "breakdownByRole": [
      {
        "staffRole": "Senior Engineer",
        "tenureBand": "2-5 years",
        "casesCount": 45,
        "currentAvgIncrease": 6800.00,
        "proposedAvgIncrease": 8200.00,
        "avgDelta": 1400.00,
        "totalDelta": 63000.00
      }
    ],
    "caseLevelDetails": [
      {
        "caseId": "uuid",
        "staffId": "12345",
        "fullName": "Jane Smith",
        "currentRecommended": 7500.00,
        "proposedRecommended": 8900.00,
        "delta": 1400.00
      }
    ]
  }
}
```

---

### POST /market-rules/apply-snapshot

Apply computation snapshot to cycle. Freezes recommendations using current rules. Requires ADMIN role.

**Request Body**:
```json
{
  "cycleId": "uuid"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "cycleId": "uuid",
    "snapshotsCreated": 683,
    "appliedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 404: Cycle not found
- 409: Cycle already has snapshots applied

---

### GET /market-rules/global-settings

Get global market rules settings.

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "defaultCatchupPercent": 75
  }
}
```

---

### PATCH /market-rules/global-settings

Update global settings. Requires ADMIN role.

**Request Body**:
```json
{
  "defaultCatchupPercent": 80
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "defaultCatchupPercent": 80,
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

## 9. Override Endpoints

### GET /overrides/manager

List manager overrides with filtering.

**Query Parameters**:
- `employeeStaffId`: Filter by employee
- `scope`: Filter by scope (GLOBAL, CYCLE)
- `cycleId`: Filter by cycle (for CYCLE scope)
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "employeeStaffId": "12345",
        "managerStaffId": "98765",
        "scope": "GLOBAL",
        "cycleId": null,
        "previousManagerStaffId": "88888",
        "createdBy": {
          "fullName": "Admin User"
        },
        "createdAt": "2026-02-15T10:00:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

---

### POST /overrides/manager

Create manager override. Requires ADMIN or HR role.

**Request Body**:
```json
{
  "employeeStaffId": "12345",
  "managerStaffId": "98765",
  "scope": "GLOBAL",
  "cycleId": null
}
```

For CYCLE scope:
```json
{
  "employeeStaffId": "12345",
  "managerStaffId": "98765",
  "scope": "CYCLE",
  "cycleId": "uuid"
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employeeStaffId": "12345",
    "managerStaffId": "98765",
    "scope": "GLOBAL",
    "cycleId": null,
    "createdBy": {
      "id": "uuid",
      "fullName": "Admin User"
    },
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 403: Insufficient permissions
- 409: Override already exists for this employee + scope + cycle combination
- 422: Validation errors (e.g., cycleId required for CYCLE scope)

---

### DELETE /overrides/manager/:id

Delete manager override. Requires ADMIN or HR role.

**Success Response** (204): No content

---

### GET /overrides/resolved-manager

Resolve manager for specific employee and cycle using override precedence.

**Query Parameters**:
- `employeeStaffId`: Employee staff ID (required)
- `cycleId`: Cycle ID (required)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "employeeStaffId": "12345",
    "cycleId": "uuid",
    "resolvedManagerStaffId": "98765",
    "source": "CYCLE_OVERRIDE",
    "override": {
      "id": "uuid",
      "scope": "CYCLE",
      "createdAt": "2026-02-15T10:00:00Z"
    }
  }
}
```

`source` values:
- `CYCLE_OVERRIDE`: Cycle-specific override applied
- `GLOBAL_OVERRIDE`: Global override applied
- `INTAKE`: Manager from intake upload (no override)

---

## 10. Export Endpoints

### GET /exports/payroll

Export payroll processing file (CSV or Excel).

**Query Parameters**:
- `cycleId`: Target cycle (required)
- `format`: File format (`csv` or `xlsx`, default: `csv`)
- `statuses`: Comma-separated statuses to include (default: `APPROVED,RELEASED_TO_PAYROLL`)
- `includeRemoved`: Include removed cases (default: `false`)

**Success Response** (200):
- Content-Type: `text/csv` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="payroll_export_cycle_name_date.csv"`
- Body: CSV/Excel file

**CSV Columns**:
- Staff ID
- Full Name
- Company Name
- Staff Role
- Contact Type
- Current Base Salary
- Approved New Base Salary
- Approved Fixed Allowances
- Approved Variable Allowances
- Approved Recurring Bonuses
- Approved Total Compensation
- Increase Amount
- Increase Percent
- Effectivity Date
- Status
- Manager Staff ID
- Success Manager Staff ID
- Relationship Manager Staff ID

---

### GET /exports/removed-cases

Export removed from scope cases.

**Query Parameters**:
- `cycleId`: Target cycle (required)
- `format`: File format (`csv` or `xlsx`)

**Success Response** (200):
- CSV/Excel file with removed cases and removal date

---

### GET /exports/movement-logs

Export movement logs for cycle.

**Query Parameters**:
- `cycleId`: Target cycle (required)
- `format`: File format (`csv` or `xlsx`)
- `movementType`: Filter by type (ADDED, REMOVED, RE_ADDED, FIELD_CHANGE)

**Success Response** (200):
- CSV/Excel file with movement log entries

---

### GET /exports/overrides-report

Export overrides report showing all override cases.

**Query Parameters**:
- `cycleId`: Target cycle (required)
- `format`: File format (`csv` or `xlsx`)

**Success Response** (200):
- CSV/Excel file with override details, reasons, and cost impact

---

## 11. Dashboard Endpoints

### GET /dashboard/cycle-stats

Get cycle statistics and metrics.

**Query Parameters**:
- `cycleId`: Target cycle (required)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "cycleId": "uuid",
    "cycleName": "Annual AU FY 2026",
    "totalCases": 683,
    "byStatus": {
      "DRAFT": 58,
      "IN_REVIEW": 124,
      "BLOCKED": 8,
      "APPROVED": 412,
      "RELEASED_TO_PAYROLL": 203,
      "REMOVED_FROM_SCOPE": 17
    },
    "missingBenchmark": 12,
    "hasOverride": 45,
    "missingApprovalEvidence": 3,
    "readyForPayroll": 203,
    "totalIncreaseCost": 5427800.00,
    "averageIncreasePercent": 8.24
  }
}
```

---

### GET /dashboard/completion-by-department

Get completion metrics grouped by company/department.

**Query Parameters**:
- `cycleId`: Target cycle (required)

**Success Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "companyName": "Acme Corp",
      "totalCases": 245,
      "completed": 198,
      "inProgress": 42,
      "blocked": 5,
      "completionPercent": 80.82
    },
    {
      "companyName": "Beta Inc",
      "totalCases": 438,
      "completed": 381,
      "inProgress": 52,
      "blocked": 5,
      "completionPercent": 86.99
    }
  ]
}
```

---

### GET /dashboard/blockers-summary

Get summary of blocked cases grouped by blocker reason.

**Query Parameters**:
- `cycleId`: Target cycle (required)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "totalBlocked": 8,
    "blockers": [
      {
        "reason": "Missing approval evidence",
        "count": 3,
        "cases": [
          {
            "id": "uuid",
            "staffId": "12345",
            "fullName": "Jane Smith",
            "companyName": "Acme Corp"
          }
        ]
      },
      {
        "reason": "Missing market benchmark",
        "count": 5,
        "cases": [ ... ]
      }
    ]
  }
}
```

---

### GET /dashboard/overrides-analysis

Get analysis of override cases and cost impact.

**Query Parameters**:
- `cycleId`: Target cycle (required)

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "totalOverrides": 45,
    "totalOverrideCost": 342500.00,
    "averageOverrideAmount": 7611.11,
    "overridesByRole": [
      {
        "staffRole": "Senior Engineer",
        "count": 18,
        "totalCost": 156000.00,
        "avgAmount": 8666.67
      }
    ]
  }
}
```

---

## 12. Admin Endpoints

### GET /admin/field-groups

List field groups and their field mappings.

**Success Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Current Compensation",
      "description": "Fields related to current compensation data",
      "fields": [
        "current_base_salary",
        "current_fixed_allowances",
        "current_variable_allowances",
        "current_recurring_bonuses",
        "current_onetime_bonuses"
      ],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /admin/field-groups

Create field group. Requires ADMIN role.

**Request Body**:
```json
{
  "name": "Current Compensation",
  "description": "Fields related to current compensation data",
  "fields": [
    "current_base_salary",
    "current_fixed_allowances",
    "current_variable_allowances"
  ]
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Current Compensation",
    "description": "Fields related to current compensation data",
    "fields": [ ... ],
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### GET /admin/permissions

Get permissions matrix (field groups × roles).

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "matrix": [
      {
        "fieldGroup": {
          "id": "uuid",
          "name": "Current Compensation"
        },
        "permissions": {
          "ADMIN": { "canView": true, "canEdit": true },
          "HR": { "canView": true, "canEdit": true },
          "FINANCE": { "canView": true, "canEdit": false },
          "PAYROLL": { "canView": true, "canEdit": false },
          "MANAGER": { "canView": true, "canEdit": false }
        }
      }
    ]
  }
}
```

---

### PATCH /admin/permissions

Update permissions for field group + role. Requires ADMIN role.

**Request Body**:
```json
{
  "fieldGroupId": "uuid",
  "roleId": "uuid",
  "canView": true,
  "canEdit": false
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "fieldGroupId": "uuid",
    "roleId": "uuid",
    "canView": true,
    "canEdit": false,
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### GET /admin/users

List users with role assignments.

**Query Parameters**:
- `role`: Filter by role name
- `isActive`: Filter by active status
- `search`: Search by email or name
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "user@yourcompany.com",
        "fullName": "John Doe",
        "staffId": "12345",
        "isActive": true,
        "roles": ["HR", "MANAGER"],
        "lastLoginAt": "2026-02-26T09:15:00Z",
        "createdAt": "2026-01-10T08:00:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

---

### PATCH /admin/users/:id/roles

Update user's role assignments. Requires ADMIN role.

**Request Body**:
```json
{
  "roleIds": ["uuid1", "uuid2"]
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "roles": ["HR", "MANAGER"],
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### GET /admin/email-domains

List whitelisted email domains.

**Success Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "domain": "yourcompany.com",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /admin/email-domains

Add email domain to whitelist. Requires ADMIN role.

**Request Body**:
```json
{
  "domain": "partner.com",
  "isActive": true
}
```

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "domain": "partner.com",
    "isActive": true,
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

---

### GET /admin/audit-events

Query audit events with filtering.

**Query Parameters**:
- `entityType`: Filter by entity type (CYCLE, CASE, APPROVAL, etc.)
- `entityId`: Filter by entity ID
- `actorId`: Filter by actor (user who performed action)
- `action`: Filter by action type
- `startDate`, `endDate`: Date range filter
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "entityType": "CASE",
        "entityId": "uuid",
        "action": "STATUS_CHANGED",
        "actor": {
          "id": "uuid",
          "email": "user@yourcompany.com",
          "fullName": "John Doe"
        },
        "before": { "status": "DRAFT" },
        "after": { "status": "IN_REVIEW" },
        "changes": {
          "status": { "old": "DRAFT", "new": "IN_REVIEW" }
        },
        "createdAt": "2026-02-26T10:30:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

---

### GET /admin/unmapped-values

Get unmapped contact type values detected during imports. Used by Admin to manage dynamic mappings.

**Query Parameters**:
- `field`: Filter by field name (default: `contact_type`)
- `status`: Filter by status (OPEN, RESOLVED, IGNORED; default: OPEN)
- `page`, `limit`, `sort`

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "fieldName": "contact_type",
        "rawValue": "Ops Staff - Manager",
        "firstSeenUploadId": "uuid",
        "lastSeenUploadId": "uuid",
        "occurrencesCount": 5,
        "status": "OPEN",
        "resolvedBy": null,
        "resolvedAt": null,
        "createdAt": "2026-02-20T08:00:00Z",
        "updatedAt": "2026-02-25T14:30:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

**Requires**: ADMIN role

---

### POST /admin/contact-type-mappings

Create or register a new contact type mapping. Maps raw value to standard output.

**Request Body**:
```json
{
  "rawValue": "Ops Staff - Manager",
  "mappedValue": "Ops Active"
}
```

**Valid `mappedValue` options**:
- `Ops Active`, `Ops Separated`, `Active`, `Reprofile`, `Floating`, `Maternity`, `Separated`, `Leave`, `AU Active`, `AU Separated`, `Unmapped`

**Success Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "rawValue": "Ops Staff - Manager",
    "mappedValue": "Ops Active",
    "status": "ACTIVE",
    "createdBy": {
      "id": "uuid",
      "fullName": "Admin User"
    },
    "createdAt": "2026-02-26T10:30:00Z"
  }
}
```

**Error Responses**:
- 400: Invalid `mappedValue`
- 409: Raw value already mapped

**Requires**: ADMIN role

---

### PATCH /admin/contact-type-mappings/:id

Update existing contact type mapping. Can change target value or disable.

**Request Body**:
```json
{
  "mappedValue": "Ops Separated",
  "status": "ACTIVE"
}
```

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "rawValue": "Ops Staff - Manager",
    "mappedValue": "Ops Separated",
    "status": "ACTIVE",
    "updatedAt": "2026-02-26T10:30:00Z"
  }
}
```

**Requires**: ADMIN role

---

### POST /admin/unmapped-values/:id/resolve

Resolve an unmapped value by applying a mapping or marking as ignored. Optionally apply retroactively to active cycle.

**Request Body**:
```json
{
  "action": "MAP",
  "mappedValue": "Ops Active",
  "applyToActiveCycle": false
}
```

**`action` options**:
- `MAP`: Create mapping using `mappedValue`
- `IGNORE`: Mark as `IGNORED`, rows stay `Unmapped`
- `DISABLE_MAPPING`: Disable existing mapping for this raw value

**Success Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fieldName": "contact_type",
    "rawValue": "Ops Staff - Manager",
    "status": "RESOLVED",
    "resolvedBy": {
      "id": "uuid",
      "fullName": "Admin User"
    },
    "resolvedAt": "2026-02-26T10:30:00Z",
    "message": "Mapping applied. Not retroactively applied (applyToActiveCycle=false)"
  }
}
```

**Optional `applyToActiveCycle` behavior**:
- If `true` and `action=MAP`:
  - Sealed cycles: NO retroactive update (immutable)
  - Active cycles: Update existing `FLAGGED` rows in active cycle to new mapped value (with audit trail)
- If `false`: Mapping applies to future imports only

**Requires**: ADMIN role

**Note**: Retroactive application is optional but recommended for consistency across current cycle data.

---

## Error Codes Reference

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_REQUEST` | 400 | Malformed request body or parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token |
| `INVALID_OTP` | 401 | OTP code is incorrect |
| `OTP_EXPIRED` | 401 | OTP code has expired |
| `FORBIDDEN` | 403 | Insufficient permissions for this action |
| `EMAIL_DOMAIN_NOT_ALLOWED` | 403 | Email domain not whitelisted |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource does not exist |
| `CYCLE_ALREADY_ACTIVE` | 409 | Another cycle of same type is already active |
| `IMPORTS_LOCKED` | 409 | Cannot upload to cycle with locked imports |
| `CYCLE_SEALED` | 409 | Cannot modify sealed cycle |
| `CASE_LOCKED` | 409 | Cannot modify locked case |
| `ALREADY_COMPLETED` | 409 | Checklist item already completed |
| `DUPLICATE_RESOURCE` | 409 | Resource already exists |
| `VALIDATION_ERROR` | 422 | Request validation failed |
| `MISSING_BENCHMARK` | 422 | No market benchmark for role + tenure |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limiting

**Global Limits**:
- 1000 requests per 15 minutes per user
- 100 requests per minute per user

**OTP Specific Limits**:
- 5 OTP requests per email per hour
- 10 OTP requests per IP per hour
- 5 OTP verification attempts per email per 15 minutes

**Upload Limits**:
- 10 uploads per hour per user

**Rate Limit Headers**:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1709028900
```

---

## Pagination

**Request Parameters**:
- `page`: Page number (1-indexed, default: 1)
- `limit`: Items per page (default varies by endpoint, max: 200)

**Response Structure**:
```json
{
  "items": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 683,
    "totalPages": 14,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Sorting

**Query Parameter Format**:
```
sort=field:direction
```

**Examples**:
- `sort=fullName:asc`
- `sort=updatedAt:desc`
- `sort=status:asc,fullName:asc` (multiple fields)

**Supported Directions**:
- `asc`: Ascending
- `desc`: Descending

---

## Filtering

**Query Parameter Patterns**:
- Exact match: `status=DRAFT`
- Multiple values (OR): `status=DRAFT,IN_REVIEW`
- Boolean: `isMissingBenchmark=true`
- Partial match (text search): `search=Smith`

**Date Filtering** (ISO 8601 format):
- `startDate=2026-01-01T00:00:00Z`
- `endDate=2026-12-31T23:59:59Z`

---

## Webhooks (Future Enhancement)

For real-time notifications, webhook support can be added:

**Webhook Events**:
- `cycle.created`
- `cycle.sealed`
- `case.status_changed`
- `upload.completed`
- `checklist.item_completed`

**Webhook Payload**:
```json
{
  "event": "case.status_changed",
  "timestamp": "2026-02-26T10:30:00Z",
  "data": {
    "caseId": "uuid",
    "oldStatus": "DRAFT",
    "newStatus": "IN_REVIEW"
  }
}
```

---

This completes the API contracts documentation. All endpoints follow consistent patterns for authentication, error handling, pagination, and response formatting.
