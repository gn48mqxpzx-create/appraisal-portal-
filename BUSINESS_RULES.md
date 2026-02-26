# Business Rules and Algorithms Documentation
## Salary Appraisal Workflow System

### Version: 1.0
### Date: February 26, 2026

---

## Overview

This document provides detailed pseudocode algorithms and business rule specifications for all critical system operations.

---

## 1. Intake Upload Processing Algorithm

### Purpose
Process spreadsheet uploads to define cycle scope, detect changes, and log movements. **Imports never block due to data flags**—all rows are processed and results captured per row.

### Inputs
- CSV/Excel file with employee data
- Cycle ID
- Uploaded by User ID

### Pre-conditions
- Cycle exists
- Cycle imports are not locked (`cycle.importsLocked = false`)

### Non-Blocking Import Philosophy
- **Upload batch always completes** even if individual rows are flagged or error
- **Row-level status** recorded: `IMPORTED`, `FLAGGED`, `ERROR`
- **Errors do not halt processing**; they mark rows as `ERROR` with reasons and continue
- **Duplicates follow "first row wins"**: later duplicates are ignored and flagged `DUPLICATE_STAFF_ID`
- **Unmapped contact types** get flag `UNMAPPED_CONTACT_TYPE` and batch processes to completion
- **Report generation**: Questionable-data report exported per batch includes all flags and raw values

### Algorithm

```pseudocode
FUNCTION processIntakeUpload(file, cycleId, userId):
    
    // STEP 1: Create upload batch record
    batchId = generateUUID()
    CREATE UploadBatch {
        id: batchId,
        cycleId: cycleId,
        uploadType: INTAKE,
        fileName: file.originalName,
        uploadedBy: userId,
        uploadedAt: NOW(),
        totalRows: 0,
        processingStatus: PROCESSING
    }
    
    // STEP 2: Parse file
    rows = parseSpreadsheet(file)
    totalRows = rows.length
    
    UPDATE UploadBatch SET totalRows = totalRows WHERE id = batchId
    
    // STEP 3: Validate rows and build in-scope set
    validRows = []
    rowResults = []
    seenStaffIds = new Set()
    
    FOR EACH row IN rows WITH index i:
        rowNumber = i + 1
        flags = []
        status = IMPORTED
        
        // Required field validation
        IF row.staffId IS NULL OR row.staffId IS EMPTY:
            flags.push("MISSING_STAFF_ID")
            status = ERROR
        
        IF row.fullName IS NULL OR row.fullName IS EMPTY:
            flags.push("MISSING_FULL_NAME")
            status = ERROR
        
        IF row.companyName IS NULL OR row.companyName IS EMPTY:
            flags.push("MISSING_COMPANY_NAME")
            status = ERROR
        
        // Contact Type mapping (see mapping algorithm)
        mappedContactType = mapContactType(row.contactType)
        IF mappedContactType = "Unmapped":
            flags.push("UNMAPPED_CONTACT_TYPE")
            status = FLAGGED
            // Record unmapped value for admin review
            recordUnmappedValue(row.contactType, batchId)
        
        IF row.managerStaffId IS NULL OR row.managerStaffId IS EMPTY:
            flags.push("MISSING_MANAGER_STAFF_ID")
            status = FLAGGED
        
        IF row.managerStaffId EQUALS row.staffId:
            flags.push("MANAGER_EQUALS_SELF")
            status = FLAGGED
        
        // Duplicate detection (first row wins)
        IF row.staffId IN seenStaffIds:
            flags.push("DUPLICATE_STAFF_ID")
            status = FLAGGED
            // Skip adding to validRows
        ELSE:
            seenStaffIds.add(row.staffId)
            
            // Cross-reference existing data
            existingCase = FIND AppraisalCase WHERE staffId = row.staffId AND cycleId != cycleId
            IF existingCase EXISTS:
                IF existingCase.fullName != row.fullName:
                    flags.push("FULL_NAME_MISMATCH")
                    status = FLAGGED
                
                IF existingCase.companyName != row.companyName:
                    flags.push("COMPANY_MISMATCH")
                    status = FLAGGED
            
            IF status = IMPORTED:
                validRows.push(row)
        
        // Store row result
        CREATE UploadRowResult {
            batchId: batchId,
            rowNumber: rowNumber,
            status: status,
            flags: flags,
            errorMessage: flags.length > 0 ? flags.join(", ") : NULL,
            rawData: row
        }
        
        rowResults.push({ status, flags })
    END FOR
    
    // STEP 4: Build in-scope set
    inScopeStaffIds = [row.staffId FOR row IN validRows]
    
    // STEP 5: Detect removed cases
    existingInScope = FIND ALL AppraisalCase WHERE {
        cycleId = cycleId,
        status != 'REMOVED_FROM_SCOPE'
    }
    
    existingStaffIds = [case.staffId FOR case IN existingInScope]
    removedStaffIds = existingStaffIds - inScopeStaffIds
    
    removedCount = 0
    FOR EACH staffId IN removedStaffIds:
        case = FIND AppraisalCase WHERE staffId = staffId AND cycleId = cycleId
        
        UPDATE AppraisalCase SET {
            status: 'REMOVED_FROM_SCOPE',
            isRemoved: true,
            closeDate: NOW()
        } WHERE id = case.id
        
        CREATE CaseMovementLog {
            caseId: case.id,
            movementType: REMOVED,
            timestamp: NOW()
        }
        
        removedCount++
    END FOR
    
    // STEP 6: Detect re-added cases
    previouslyRemoved = FIND ALL AppraisalCase WHERE {
        cycleId = cycleId,
        status = 'REMOVED_FROM_SCOPE'
    }
    
    previouslyRemovedStaffIds = [case.staffId FOR case IN previouslyRemoved]
    readdedStaffIds = inScopeStaffIds ∩ previouslyRemovedStaffIds
    
    readdedCount = 0
    FOR EACH staffId IN readdedStaffIds:
        case = FIND AppraisalCase WHERE staffId = staffId AND cycleId = cycleId
        
        UPDATE AppraisalCase SET {
            status: 'DRAFT',
            isRemoved: false,
            closeDate: NULL
        } WHERE id = case.id
        
        CREATE CaseMovementLog {
            caseId: case.id,
            movementType: RE_ADDED,
            timestamp: NOW()
        }
        
        readdedCount++
    END FOR
    
    // STEP 7: Upsert cases (insert new or update existing)
    addedCount = 0
    updatedCount = 0
    
    FOR EACH row IN validRows:
        existingCase = FIND AppraisalCase WHERE {
            staffId = row.staffId,
            cycleId = cycleId
        }
        
        IF existingCase EXISTS:
            // Update existing case and detect field changes
            changes = []
            
            IF existingCase.fullName != row.fullName:
                changes.push({
                    fieldName: "full_name",
                    oldValue: existingCase.fullName,
                    newValue: row.fullName
                })
            
            IF existingCase.companyName != row.companyName:
                changes.push({
                    fieldName: "company_name",
                    oldValue: existingCase.companyName,
                    newValue: row.companyName
                })
            
            IF existingCase.staffRole != row.staffRole:
                changes.push({
                    fieldName: "staff_role",
                    oldValue: existingCase.staffRole,
                    newValue: row.staffRole
                })
            
            IF existingCase.managerStaffIdFromIntake != row.managerStaffId:
                changes.push({
                    fieldName: "manager_staff_id",
                    oldValue: existingCase.managerStaffIdFromIntake,
                    newValue: row.managerStaffId
                })
            
            IF existingCase.successManagerStaffId != row.successManagerStaffId:
                changes.push({
                    fieldName: "success_manager_staff_id",
                    oldValue: existingCase.successManagerStaffId,
                    newValue: row.successManagerStaffId
                })
            
            IF existingCase.relationshipManagerStaffId != row.relationshipManagerStaffId:
                changes.push({
                    fieldName: "relationship_manager_staff_id",
                    oldValue: existingCase.relationshipManagerStaffId,
                    newValue: row.relationshipManagerStaffId
                })
            
            // Update case
            UPDATE AppraisalCase SET {
                fullName: row.fullName,
                companyName: row.companyName,
                staffRole: row.staffRole,
                contactType: row.contactType,
                managerStaffIdFromIntake: row.managerStaffId,
                successManagerStaffId: row.successManagerStaffId,
                relationshipManagerStaffId: row.relationshipManagerStaffId,
                updatedAt: NOW(),
                updatedBy: userId
            } WHERE id = existingCase.id
            
            // Log field changes
            FOR EACH change IN changes:
                CREATE CaseMovementLog {
                    caseId: existingCase.id,
                    movementType: FIELD_CHANGE,
                    fieldName: change.fieldName,
                    oldValue: change.oldValue,
                    newValue: change.newValue,
                    timestamp: NOW()
                }
            END FOR
            
            IF changes.length > 0:
                updatedCount++
        
        ELSE:
            // Insert new case
            tenureMonths = calculateTenureMonths(row.startDate, NOW())
            
            newCase = CREATE AppraisalCase {
                id: generateUUID(),
                cycleId: cycleId,
                staffId: row.staffId,
                fullName: row.fullName,
                contactType: row.contactType,
                companyName: row.companyName,
                staffRole: row.staffRole,
                startDate: row.startDate,
                successManagerStaffId: row.successManagerStaffId,
                relationshipManagerStaffId: row.relationshipManagerStaffId,
                managerStaffIdFromIntake: row.managerStaffId,
                resolvedManagerStaffId: row.managerStaffId,
                status: DRAFT,
                tenureMonths: tenureMonths,
                tenureComputedAt: NOW(),
                createdAt: NOW()
            }
            
            // Create empty compensation record
            CREATE CaseCompensation {
                caseId: newCase.id
            }
            
            // Create movement log
            CREATE CaseMovementLog {
                caseId: newCase.id,
                movementType: ADDED,
                timestamp: NOW()
            }
            
            addedCount++
        END IF
    END FOR
    
    // STEP 8: Update batch with results
    importedCount = COUNT rowResults WHERE status = IMPORTED
    flaggedCount = COUNT rowResults WHERE status = FLAGGED
    errorCount = COUNT rowResults WHERE status = ERROR
    
    UPDATE UploadBatch SET {
        processingStatus: COMPLETED,
        processedAt: NOW(),
        importedCount: importedCount,
        flaggedCount: flaggedCount,
        errorCount: errorCount,
        addedCount: addedCount,
        removedCount: removedCount,
        readdedCount: readdedCount,
        updatedCount: updatedCount
    } WHERE id = batchId
    
    // STEP 9: Create audit event
    CREATE AuditEvent {
        entityType: UPLOAD_BATCH,
        entityId: batchId,
        action: INTAKE_UPLOAD_COMPLETED,
        actorId: userId,
        after: {
            totalRows: totalRows,
            imported: importedCount,
            flagged: flaggedCount,
            errors: errorCount,
            added: addedCount,
            removed: removedCount,
            readded: readdedCount,
            updated: updatedCount
        }
    }
    
    RETURN {
        batchId: batchId,
        totalRows: totalRows,
        importedCount: importedCount,
        flaggedCount: flaggedCount,
        errorCount: errorCount,
        addedCount: addedCount,
        removedCount: removedCount,
        readdedCount: readdedCount,
        updatedCount: updatedCount
    }
END FUNCTION
```

### Post-conditions
- Upload batch created with processing results
- In-scope cases created or updated
- Removed cases marked with `status = REMOVED_FROM_SCOPE`
- Re-added cases restored to `status = DRAFT`
- All movements logged in `CaseMovementLog`
- Audit event created

---

## 2. Contact Type Mapping Algorithm

### Purpose
Map raw contact type values from intake uploads to standardized output values. Support dynamic mapping where new unmapped values are detected and flagged for admin configuration without blocking imports.

### Mapping Rules

The following mapping is applied to raw contact type values:

```
Ops Staff - Active               → Ops Active
Ops Staff - Separated            → Ops Separated
Ops Staff - LOA                  → Leave
Staff Member - Active            → Active
Staff Member - For Reprofile     → Reprofile
Staff Member - HR Floating       → Floating
Staff Member - Maternity         → Maternity
Staff Member - Separated         → Separated
Staff Member - Sabbatical        → Leave
Onshore Staff Member             → AU Active
Onshore Staff - Separated        → AU Separated
[Any other value]                → Unmapped
```

### Algorithm

```pseudocode
FUNCTION mapContactType(rawValue):
    
    // STEP 1: Check if mapping exists in contact_type_mappings
    mapping = FIND ContactTypeMapping WHERE {
        rawValue = rawValue,
        status = 'ACTIVE'
    }
    
    IF mapping EXISTS:
        RETURN mapping.mappedValue
    
    // STEP 2: Check static mapping rules
    staticMap = {
        "Ops Staff - Active": "Ops Active",
        "Ops Staff - Separated": "Ops Separated",
        "Ops Staff - LOA": "Leave",
        "Staff Member - Active": "Active",
        "Staff Member - For Reprofile": "Reprofile",
        "Staff Member - HR Floating": "Floating",
        "Staff Member - Maternity": "Maternity",
        "Staff Member - Separated": "Separated",
        "Staff Member - Sabbatical": "Leave",
        "Onshore Staff Member": "AU Active",
        "Onshore Staff - Separated": "AU Separated"
    }
    
    IF rawValue IN staticMap:
        RETURN staticMap[rawValue]
    
    // STEP 3: No mapping found—return unmapped
    RETURN "Unmapped"
    
END FUNCTION

FUNCTION recordUnmappedValue(rawValue, uploadBatchId):
    
    // Check if this raw value was seen before
    existingEvent = FIND UnmappedValueEvent WHERE {
        rawValue = rawValue,
        fieldName = 'contact_type'
    }
    
    IF existingEvent EXISTS:
        // Update counts
        UPDATE UnmappedValueEvent SET {
            lastSeenUploadId: uploadBatchId,
            occurrencesCount: occurrencesCount + 1,
            updatedAt: NOW()
        } WHERE id = existingEvent.id
    ELSE:
        // Create new unmapped event
        CREATE UnmappedValueEvent {
            id: generateUUID(),
            fieldName: 'contact_type',
            rawValue: rawValue,
            firstSeenUploadId: uploadBatchId,
            lastSeenUploadId: uploadBatchId,
            occurrencesCount: 1,
            status: 'OPEN',
            resolvedBy: NULL,
            resolvedAt: NULL,
            createdAt: NOW()
        }
    
END FUNCTION
```

### Admin Resolution Workflow

When unmapped values are detected:

1. **Batch completes successfully** with `UNMAPPED_CONTACT_TYPE` flags recorded
2. **Admin notification**: Unmapped value appears in Admin UI
3. **Admin chooses one of**:
   - **Map it**: Adds dynamic mapping to `contact_type_mappings` table
   - **Ignore it**: Marks event as `IGNORED`, rows remain `Unmapped`
   - **Disable a mapping**: Sets status to `DISABLED` for future imports

### Application Rules for Retroactive Updates

Once Admin creates a mapping for a previously unmapped value:

- **Sealed cycles**: NEVER rewritten; sealed data is immutable
- **Active cycles**: Admin can choose scope:
  - **Apply to future imports only**: New rows use the mapping, existing flagged rows stay `Unmapped`
  - **Apply retroactively**: Update existing flagged rows in active cycle to the mapped value (with audit trail)

---

## 3. Manager Override Resolution Algorithm

### Purpose
Resolve the effective manager for an employee using override precedence.

### Precedence Rules
1. Cycle-specific override (highest priority)
2. Global override
3. Intake manager value (lowest priority)

### Algorithm

```pseudocode
FUNCTION resolveManagerStaffId(employeeStaffId, cycleId):
    
    // STEP 1: Check for cycle-specific override
    cycleOverride = FIND ManagerOverride WHERE {
        employeeStaffId = employeeStaffId,
        scope = 'CYCLE',
        cycleId = cycleId
    }
    
    IF cycleOverride EXISTS:
        RETURN {
            managerStaffId: cycleOverride.managerStaffId,
            source: 'CYCLE_OVERRIDE',
            overrideId: cycleOverride.id
        }
    
    // STEP 2: Check for global override
    globalOverride = FIND ManagerOverride WHERE {
        employeeStaffId = employeeStaffId,
        scope = 'GLOBAL'
    }
    
    IF globalOverride EXISTS:
        RETURN {
            managerStaffId: globalOverride.managerStaffId,
            source: 'GLOBAL_OVERRIDE',
            overrideId: globalOverride.id
        }
    
    // STEP 3: Use intake value
    case = FIND AppraisalCase WHERE {
        staffId = employeeStaffId,
        cycleId = cycleId
    }
    
    IF case EXISTS:
        RETURN {
            managerStaffId: case.managerStaffIdFromIntake,
            source: 'INTAKE',
            overrideId: NULL
        }
    
    // STEP 4: No case found
    RETURN {
        managerStaffId: NULL,
        source: 'NOT_FOUND',
        overrideId: NULL
    }
    
END FUNCTION
```

### Usage
Call this function whenever:
- Displaying manager information
- Filtering cases for manager view
- Updating `resolvedManagerStaffId` field on case

---

## 4. Market Recommendation Computation Algorithm

### Purpose
Compute salary adjustment recommendation based on market benchmarks, tenure, and catch-up percentage.

### Inputs
- Case ID or AppraisalCase object

### Algorithm

```pseudocode
FUNCTION computeRecommendation(caseId):
    
    // STEP 1: Load case data
    case = FIND AppraisalCase WHERE id = caseId INCLUDE compensation
    
    IF case IS NULL:
        THROW Error("Case not found")
    
    currentBaseSalary = case.compensation.currentBaseSalary
    staffRole = case.staffRole
    tenureMonths = case.tenureMonths
    
    // STEP 2: Find tenure band
    tenureBand = FIND TenureBand WHERE {
        minMonths <= tenureMonths,
        maxMonths >= tenureMonths
    }
    
    IF tenureBand IS NULL:
        // No tenure band found
        UPDATE AppraisalCase SET isMissingBenchmark = true WHERE id = caseId
        
        RETURN {
            isMissingBenchmark: true,
            message: "No tenure band found for " + tenureMonths + " months",
            recommendedIncreaseAmount: 0
        }
    
    // STEP 3: Find market benchmark
    benchmark = FIND MarketBenchmark WHERE {
        staffRole = staffRole,
        tenureBandId = tenureBand.id,
        isActive = true
    }
    
    IF benchmark IS NULL:
        // No benchmark found
        UPDATE AppraisalCase SET isMissingBenchmark = true WHERE id = caseId
        
        RETURN {
            isMissingBenchmark: true,
            message: "No market benchmark for role '" + staffRole + "' and tenure " + tenureBand.name,
            recommendedIncreaseAmount: 0
        }
    
    // STEP 4: Determine catch-up percent
    IF benchmark.catchupPercent IS NOT NULL:
        catchupPercent = benchmark.catchupPercent
    ELSE:
        globalSetting = FIND GlobalSettings WHERE key = 'DEFAULT_CATCHUP_PERCENT'
        catchupPercent = parseInt(globalSetting.value) OR 75
    
    // STEP 5: Calculate variance
    benchmarkBaseSalary = benchmark.baseSalary
    varianceAmount = benchmarkBaseSalary - currentBaseSalary
    
    IF currentBaseSalary = 0:
        variancePercent = NULL
        UPDATE AppraisalCase SET isMissingBenchmark = true WHERE id = caseId
        
        RETURN {
            isMissingBenchmark: true,
            message: "Current base salary is zero",
            recommendedIncreaseAmount: 0
        }
    ELSE:
        variancePercent = varianceAmount / currentBaseSalary
    
    // STEP 6: Compute recommendation
    IF currentBaseSalary < benchmarkBaseSalary:
        // Employee is below market
        recommendedIncreaseAmount = varianceAmount * (catchupPercent / 100)
        recommendedNewBase = currentBaseSalary + recommendedIncreaseAmount
        recommendedAdjustmentPercent = recommendedIncreaseAmount / currentBaseSalary
        message = NULL
    ELSE:
        // Employee meets or exceeds market
        recommendedIncreaseAmount = 0
        recommendedNewBase = currentBaseSalary
        recommendedAdjustmentPercent = 0
        message = "No adjustment recommended - current salary meets or exceeds market benchmark"
    
    // STEP 7: Update case compensation with snapshot
    UPDATE CaseCompensation SET {
        benchmarkUsed: benchmarkBaseSalary,
        catchupPercentUsed: catchupPercent,
        tenureMonthsUsed: tenureMonths,
        tenureComputedAt: NOW(),
        varianceAmount: varianceAmount,
        variancePercent: variancePercent,
        recommendedIncreaseAmount: recommendedIncreaseAmount,
        recommendedNewBase: recommendedNewBase,
        recommendedAdjustmentPercent: recommendedAdjustmentPercent
    } WHERE caseId = caseId
    
    UPDATE AppraisalCase SET isMissingBenchmark = false WHERE id = caseId
    
    // STEP 8: Return result
    RETURN {
        isMissingBenchmark: false,
        benchmarkUsed: benchmarkBaseSalary,
        catchupPercentUsed: catchupPercent,
        tenureMonthsUsed: tenureMonths,
        varianceAmount: varianceAmount,
        variancePercent: variancePercent,
        recommendedIncreaseAmount: recommendedIncreaseAmount,
        recommendedNewBase: recommendedNewBase,
        recommendedAdjustmentPercent: recommendedAdjustmentPercent,
        message: message
    }
    
END FUNCTION
```

### Edge Cases Handled
- **No tenure band**: Flag case, return zero recommendation
- **No benchmark**: Flag case, return zero recommendation
- **Zero current salary**: Flag case, return zero recommendation
- **Current >= benchmark**: Return zero increase with message
- **Null catch-up percent**: Use global default

---

## 5. Impact Preview Algorithm

### Purpose
Preview the impact of proposed market rules changes on a cycle before applying.

### Algorithm

```pseudocode
FUNCTION previewMarketRulesImpact(cycleId, proposedChanges):
    
    // STEP 1: Load active cases
    cases = FIND ALL AppraisalCase WHERE {
        cycleId = cycleId,
        status != 'REMOVED_FROM_SCOPE'
    } INCLUDE compensation
    
    IF cases.length = 0:
        RETURN {
            affectedCasesCount: 0,
            message: "No active cases in cycle"
        }
    
    // STEP 2: Parse proposed changes
    proposedBenchmarks = proposedChanges.benchmarks
    proposedDefaultCatchup = proposedChanges.defaultCatchupPercent
    
    // Create map for quick lookup
    benchmarkMap = new Map()
    FOR EACH proposed IN proposedBenchmarks:
        key = proposed.staffRole + ":" + proposed.tenureBandId
        benchmarkMap.set(key, proposed)
    END FOR
    
    // STEP 3: Compute impact for each case
    results = []
    totalCurrentIncrease = 0
    totalProposedIncrease = 0
    
    FOR EACH case IN cases:
        // Current recommendation
        currentRecommendation = {
            benchmarkUsed: case.compensation.benchmarkUsed,
            catchupPercentUsed: case.compensation.catchupPercentUsed,
            recommendedIncreaseAmount: case.compensation.recommendedIncreaseAmount
        }
        
        totalCurrentIncrease += currentRecommendation.recommendedIncreaseAmount
        
        // Proposed recommendation
        tenureBand = FIND TenureBand WHERE {
            minMonths <= case.tenureMonths,
            maxMonths >= case.tenureMonths
        }
        
        IF tenureBand IS NULL:
            // Skip case
            CONTINUE
        
        // Check for proposed benchmark
        key = case.staffRole + ":" + tenureBand.id
        IF benchmarkMap.has(key):
            proposedBenchmark = benchmarkMap.get(key)
            proposedBenchmarkValue = proposedBenchmark.baseSalary
            proposedCatchup = proposedBenchmark.catchupPercent OR proposedDefaultCatchup
        ELSE:
            // Use existing benchmark
            existingBenchmark = FIND MarketBenchmark WHERE {
                staffRole = case.staffRole,
                tenureBandId = tenureBand.id
            }
            
            IF existingBenchmark IS NULL:
                CONTINUE
            
            proposedBenchmarkValue = existingBenchmark.baseSalary
            proposedCatchup = existingBenchmark.catchupPercent OR proposedDefaultCatchup
        
        // Calculate proposed increase
        currentBase = case.compensation.currentBaseSalary
        proposedVariance = proposedBenchmarkValue - currentBase
        
        IF currentBase < proposedBenchmarkValue:
            proposedIncrease = proposedVariance * (proposedCatchup / 100)
        ELSE:
            proposedIncrease = 0
        
        totalProposedIncrease += proposedIncrease
        
        // Calculate delta
        delta = proposedIncrease - currentRecommendation.recommendedIncreaseAmount
        
        results.push({
            caseId: case.id,
            staffId: case.staffId,
            fullName: case.fullName,
            staffRole: case.staffRole,
            tenureBand: tenureBand.name,
            currentRecommended: currentRecommendation.recommendedIncreaseAmount,
            proposedRecommended: proposedIncrease,
            delta: delta
        })
    END FOR
    
    // STEP 4: Aggregate by staff role and tenure band
    breakdown = new Map()
    
    FOR EACH result IN results:
        key = result.staffRole + ":" + result.tenureBand
        
        IF NOT breakdown.has(key):
            breakdown.set(key, {
                staffRole: result.staffRole,
                tenureBand: result.tenureBand,
                casesCount: 0,
                totalCurrentIncrease: 0,
                totalProposedIncrease: 0,
                totalDelta: 0
            })
        
        group = breakdown.get(key)
        group.casesCount++
        group.totalCurrentIncrease += result.currentRecommended
        group.totalProposedIncrease += result.proposedRecommended
        group.totalDelta += result.delta
    END FOR
    
    // Convert map to array
    breakdownArray = Array.from(breakdown.values())
    
    // STEP 5: Calculate summary metrics
    affectedCasesCount = results.length
    totalDelta = totalProposedIncrease - totalCurrentIncrease
    percentChange = totalCurrentIncrease > 0 ? (totalDelta / totalCurrentIncrease) * 100 : 0
    
    // STEP 6: Return preview result
    RETURN {
        cycleId: cycleId,
        cycleName: cycle.name,
        affectedCasesCount: affectedCasesCount,
        currentTotalIncrease: totalCurrentIncrease,
        proposedTotalIncrease: totalProposedIncrease,
        totalDelta: totalDelta,
        percentChange: percentChange,
        breakdownByRoleAndBand: breakdownArray,
        caseLevelDetails: results
    }
    
END FUNCTION
```

### Use Case
Admin can preview impact before:
- Changing benchmark values
- Changing catch-up percentages
- Applying snapshot to cycle

---

## 5. Cycle Sealing Algorithm

### Purpose
Permanently seal a cycle, making all records read-only.

### Pre-conditions
- Imports must be locked
- No cases in DRAFT or IN_REVIEW or BLOCKED status (optional enforcement)

### Algorithm

```pseudocode
FUNCTION sealCycle(cycleId, userId):
    
    // STEP 1: Validate cycle exists
    cycle = FIND Cycle WHERE id = cycleId
    
    IF cycle IS NULL:
        THROW Error("Cycle not found")
    
    IF cycle.sealed = true:
        THROW Error("Cycle is already sealed")
    
    // STEP 2: Check imports locked
    IF cycle.importsLocked = false:
        THROW Error("Cannot seal cycle with unlocked imports")
    
    // STEP 3: Check for incomplete cases (optional strict mode)
    incompleteCases = COUNT AppraisalCase WHERE {
        cycleId = cycleId,
        status IN ['DRAFT', 'IN_REVIEW', 'BLOCKED']
    }
    
    IF incompleteCases > 0:
        THROW Error("Cannot seal cycle with " + incompleteCases + " incomplete cases")
    
    // STEP 4: Create computation snapshots for all approved/released cases
    casesToSnapshot = FIND ALL AppraisalCase WHERE {
        cycleId = cycleId,
        status IN ['APPROVED', 'RELEASED_TO_PAYROLL']
    } INCLUDE compensation
    
    snapshotsCreated = 0
    
    FOR EACH case IN casesToSnapshot:
        // Check if snapshot already exists
        existingSnapshot = FIND ComputationSnapshot WHERE caseId = case.id
        
        IF existingSnapshot IS NULL:
            // Create snapshot from current compensation
            CREATE ComputationSnapshot {
                id: generateUUID(),
                cycleId: cycleId,
                caseId: case.id,
                benchmarkUsed: case.compensation.benchmarkUsed,
                catchupPercentUsed: case.compensation.catchupPercentUsed,
                tenureMonthsUsed: case.compensation.tenureMonthsUsed,
                varianceAmount: case.compensation.varianceAmount,
                variancePercent: case.compensation.variancePercent,
                recommendedIncreaseAmount: case.compensation.recommendedIncreaseAmount,
                recommendedNewBase: case.compensation.recommendedNewBase,
                recommendedAdjustmentPercent: case.compensation.recommendedAdjustmentPercent,
                createdAt: NOW()
            }
            
            snapshotsCreated++
        END IF
    END FOR
    
    // STEP 5: Mark cycle as sealed
    UPDATE Cycle SET {
        sealed: true,
        sealedAt: NOW(),
        sealedBy: userId,
        updatedAt: NOW()
    } WHERE id = cycleId
    
    // STEP 6: Create audit event
    CREATE AuditEvent {
        entityType: 'CYCLE',
        entityId: cycleId,
        action: 'SEALED',
        actorId: userId,
        after: {
            sealed: true,
            sealedAt: NOW(),
            snapshotsCreated: snapshotsCreated
        }
    }
    
    // STEP 7: Send notifications
    notifyRoles(['ADMIN', 'HR', 'FINANCE', 'PAYROLL'], {
        subject: "Cycle Sealed: " + cycle.name,
        message: "Cycle has been sealed and is now read-only. All data is preserved for historical reference."
    })
    
    RETURN {
        success: true,
        cycleId: cycleId,
        sealedAt: NOW(),
        snapshotsCreated: snapshotsCreated
    }
    
END FUNCTION
```

### Post-conditions
- `cycle.sealed = true`
- Computation snapshots created for approved/released cases
- Audit event logged
- Notifications sent

### Enforcement
After sealing, all write operations on cycle-related entities must check:
```pseudocode
IF cycle.sealed = true:
    THROW Error("Cannot modify sealed cycle", statusCode: 409)
```

---

## 6. Checklist Completion Algorithm

### Purpose
Complete a checklist item with role-based authorization and precondition checking.

### Algorithm

```pseudocode
FUNCTION completeChecklistItem(caseId, itemKey, userId):
    
    // STEP 1: Load checklist item
    item = FIND CaseChecklistItem WHERE {
        caseId = caseId,
        itemKey = itemKey
    }
    
    IF item IS NULL:
        THROW Error("Checklist item not found")
    
    // STEP 2: Check if already completed
    IF item.completed = true:
        THROW Error("Checklist item already completed", statusCode: 409)
    
    // STEP 3: Load user and case
    user = FIND User WHERE id = userId INCLUDE roles
    case = FIND AppraisalCase WHERE id = caseId INCLUDE cycle
    
    // STEP 4: Check cycle not sealed
    IF case.cycle.sealed = true:
        THROW Error("Cannot modify checklist in sealed cycle", statusCode: 409)
    
    // STEP 5: Validate user role
    userRoles = [role.name FOR role IN user.roles]
    
    IF item.assignedRole NOT IN userRoles:
        THROW Error("User does not have role '" + item.assignedRole + "' required for this checklist item", statusCode: 403)
    
    // STEP 6: Check preconditions (item-specific rules)
    IF itemKey = 'FINANCE_APPROVAL':
        // Finance approval requires approval evidence
        approvalCount = COUNT CaseApproval WHERE {
            caseId = caseId,
            status IN ['RECEIVED', 'VERIFIED']
        }
        
        IF approvalCount = 0:
            THROW Error("Cannot complete Finance approval without approval evidence", statusCode: 422)
    
    IF itemKey = 'PAYROLL_RELEASE':
        // Payroll release requires all other items completed
        allOtherItems = FIND ALL CaseChecklistItem WHERE {
            caseId = caseId,
            itemKey != 'PAYROLL_RELEASE'
        }
        
        FOR EACH otherItem IN allOtherItems:
            IF otherItem.completed = false:
                THROW Error("Cannot release to payroll until all checklist items completed", statusCode: 422)
        END FOR
    
    // STEP 7: Complete checklist item
    UPDATE CaseChecklistItem SET {
        completed: true,
        completedBy: userId,
        completedAt: NOW()
    } WHERE id = item.id
    
    // STEP 8: Create audit event
    CREATE AuditEvent {
        entityType: 'CHECKLIST_ITEM',
        entityId: item.id,
        action: 'COMPLETED',
        actorId: userId,
        before: { completed: false },
        after: { completed: true, completedBy: userId, completedAt: NOW() }
    }
    
    // STEP 9: Check if all checklist items completed
    allItems = FIND ALL CaseChecklistItem WHERE caseId = caseId
    allCompleted = ALL items IN allItems HAVE completed = true
    
    IF allCompleted AND case.status = 'IN_REVIEW':
        // Automatically move to APPROVED
        UPDATE AppraisalCase SET {
            status: 'APPROVED',
            previousStatus: 'IN_REVIEW',
            updatedAt: NOW(),
            updatedBy: userId
        } WHERE id = caseId
        
        CREATE AuditEvent {
            entityType: 'CASE',
            entityId: caseId,
            action: 'STATUS_CHANGED',
            actorId: userId,
            before: { status: 'IN_REVIEW' },
            after: { status: 'APPROVED' }
        }
    
    // STEP 10: Send notification
    IF itemKey = 'PAYROLL_RELEASE':
        notifyRoles(['PAYROLL'], {
            subject: "Case Released to Payroll: " + case.fullName,
            message: "Case " + case.staffId + " is ready for payroll processing."
        })
    
    RETURN {
        success: true,
        checklistItem: item,
        allCompleted: allCompleted
    }
    
END FUNCTION
```

### Immutability Rule
Once `completed = true`, the checklist item cannot be unchecked. This ensures audit trail integrity.

---

## 7. Effectivity Date Tracking Algorithm

### Purpose
Automatically update effectivity status based on current date.

### Algorithm (Scheduled Job)

```pseudocode
FUNCTION updateEffectivityStatuses():
    // Run this daily at midnight
    
    today = getCurrentDate()
    
    // STEP 1: Find cases with pending effectivity that are now effective
    pendingCases = FIND ALL AppraisalCase WHERE {
        effectivityStatus = 'PENDING_EFFECTIVITY',
        effectivityDate <= today
    }
    
    FOR EACH case IN pendingCases:
        UPDATE AppraisalCase SET {
            effectivityStatus: 'EFFECTIVE',
            updatedAt: NOW()
        } WHERE id = case.id
        
        CREATE AuditEvent {
            entityType: 'CASE',
            entityId: case.id,
            action: 'EFFECTIVITY_ACTIVATED',
            before: { effectivityStatus: 'PENDING_EFFECTIVITY' },
            after: { effectivityStatus: 'EFFECTIVE' }
        }
    END FOR
    
    // STEP 2: Find cases that are effective but should be historical
    // (optional: mark as historical after 1 year)
    oneYearAgo = today - 365 days
    
    historicalCases = FIND ALL AppraisalCase WHERE {
        effectivityStatus = 'EFFECTIVE',
        effectivityDate < oneYearAgo
    }
    
    FOR EACH case IN historicalCases:
        UPDATE AppraisalCase SET {
            effectivityStatus: 'HISTORICAL',
            updatedAt: NOW()
        } WHERE id = case.id
    END FOR
    
    RETURN {
        activatedCount: pendingCases.length,
        historicalCount: historicalCases.length
    }
    
END FUNCTION
```

### Scheduling
Run this as a cron job:
```bash
0 0 * * * # Daily at midnight
```

---

## 8. Tenure Calculation Algorithm

### Purpose
Calculate tenure months and display string from start date.

### Algorithm

```pseudocode
FUNCTION calculateTenure(startDate, currentDate):
    
    // Calculate months difference
    yearsDiff = currentDate.year - startDate.year
    monthsDiff = currentDate.month - startDate.month
    
    totalMonths = (yearsDiff * 12) + monthsDiff
    
    // Handle negative (future date)
    IF totalMonths < 0:
        totalMonths = 0
    
    // Calculate display format
    years = FLOOR(totalMonths / 12)
    months = totalMonths MOD 12
    
    IF years = 0:
        displayString = months + " month" + (months != 1 ? "s" : "")
    ELSE IF months = 0:
        displayString = years + " year" + (years != 1 ? "s" : "")
    ELSE:
        displayString = years + " year" + (years != 1 ? "s" : "") + " " + months + " month" + (months != 1 ? "s" : "")
    
    RETURN {
        tenureMonths: totalMonths,
        tenureDisplay: displayString
    }
    
END FUNCTION
```

### Examples
- Start: 2023-06-15, Current: 2026-02-26 → 32 months, "2 years 8 months"
- Start: 2025-08-01, Current: 2026-02-26 → 6 months, "6 months"
- Start: 2020-01-01, Current: 2026-02-26 → 73 months, "6 years 1 month"

---

## 9. Compensation Upload Algorithm

### Purpose
Update compensation fields only, without changing cycle scope.

### Algorithm

```pseudocode
FUNCTION processCompensationUpload(file, cycleId, userId):
    
    // STEP 1: Create upload batch
    batchId = generateUUID()
    CREATE UploadBatch {
        id: batchId,
        cycleId: cycleId,
        uploadType: COMPENSATION,
        fileName: file.originalName,
        uploadedBy: userId,
        totalRows: 0,
        processingStatus: PROCESSING
    }
    
    // STEP 2: Parse file
    rows = parseSpreadsheet(file)
    UPDATE UploadBatch SET totalRows = rows.length WHERE id = batchId
    
    // STEP 3: Process each row
    importedCount = 0
    flaggedCount = 0
    errorCount = 0
    
    FOR EACH row IN rows WITH index i:
        rowNumber = i + 1
        flags = []
        status = IMPORTED
        
        // Validate staff ID
        IF row.staffId IS NULL OR row.staffId IS EMPTY:
            flags.push("MISSING_STAFF_ID")
            status = ERROR
        
        // Find case
        case = FIND AppraisalCase WHERE {
            staffId = row.staffId,
            cycleId = cycleId
        }
        
        IF case IS NULL:
            flags.push("STAFF_ID_NOT_IN_CYCLE")
            status = ERROR
        ELSE:
            // Validate compensation values
            IF row.currentBaseSalary < 0:
                flags.push("NEGATIVE_BASE_SALARY")
                status = FLAGGED
            
            IF row.currentFixedAllowances < 0:
                flags.push("NEGATIVE_FIXED_ALLOWANCES")
                status = FLAGGED
            
            // Update compensation if no errors
            IF status != ERROR:
                totalCompensation = row.currentBaseSalary + row.currentFixedAllowances + 
                                    row.currentVariableAllowances + row.currentRecurringBonuses + 
                                    row.currentOnetimeBonuses
                
                UPDATE CaseCompensation SET {
                    currentBaseSalary: row.currentBaseSalary,
                    currentFixedAllowances: row.currentFixedAllowances,
                    currentVariableAllowances: row.currentVariableAllowances,
                    currentRecurringBonuses: row.currentRecurringBonuses,
                    currentOnetimeBonuses: row.currentOnetimeBonuses,
                    currentTotalCompensation: totalCompensation,
                    updatedAt: NOW()
                } WHERE caseId = case.id
                
                importedCount++
        END IF
        
        // Store row result
        CREATE UploadRowResult {
            batchId: batchId,
            rowNumber: rowNumber,
            status: status,
            flags: flags,
            rawData: row
        }
        
        IF status = FLAGGED:
            flaggedCount++
        ELSE IF status = ERROR:
            errorCount++
    END FOR
    
    // STEP 4: Update batch
    UPDATE UploadBatch SET {
        processingStatus: COMPLETED,
        processedAt: NOW(),
        importedCount: importedCount,
        flaggedCount: flaggedCount,
        errorCount: errorCount
    } WHERE id = batchId
    
    RETURN {
        batchId: batchId,
        importedCount: importedCount,
        flaggedCount: flaggedCount,
        errorCount: errorCount
    }
    
END FUNCTION
```

---

## 10. Locking Enforcement Rules

### Purpose
Prevent modifications to locked or sealed data.

### Rule: Case-Level Locking

```pseudocode
BEFORE UPDATE AppraisalCase OR CaseCompensation OR CaseApproval OR CaseChecklistItem:
    
    case = load AppraisalCase
    
    // Check case lock
    IF case.status = 'RELEASED_TO_PAYROLL':
        IF user.role NOT IN ['ADMIN']:  // Optional: allow admin override
            THROW Error("Case is locked after release to payroll", statusCode: 409)
    
    // Check cycle seal
    cycle = load Cycle WHERE id = case.cycleId
    IF cycle.sealed = true:
        THROW Error("Cannot modify case in sealed cycle", statusCode: 409)
    
END BEFORE
```

### Rule: Cycle-Level Locking

```pseudocode
BEFORE INSERT UploadBatch WHERE uploadType = INTAKE:
    
    cycle = load Cycle WHERE id = cycleId
    
    IF cycle.importsLocked = true:
        THROW Error("Imports are locked for this cycle", statusCode: 409)
    
END BEFORE
```

---

This completes the business rules documentation. All algorithms include error handling, audit logging, and enforcement of system constraints.
