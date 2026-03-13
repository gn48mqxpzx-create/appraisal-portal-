# Market Framework Refactor - Quick Reference Card

## 📌 KEY FILES & LOCATIONS

### Frontend (React Components)
```
apps/web/src/pages/admin/
├── MarketFramework.tsx ..................... Main container (35 lines)
├── RoleStandardizationTab.tsx .............. Unified role table (280 lines)  
├── MarketMatrixTab.tsx .................... Matrix form + reference (320 lines)
└── [other tabs]

apps/web/src/pages/
└── AdminConsole.tsx ....................... Routes to MarketFramework
    AdminConsole.module.css ................ Tab styles (+45 lines)
```

### Backend (API)
```
apps/api/src/
└── index.ts ............................... GET /market-matrix/roles-without-matrices (+40 lines)
```

### Database
```
No changes. All tables intact:
├── StandardizedRole
├── MarketValueMatrix
└── RoleAlignmentMapping
```

---

## 🎛️ UI STRUCTURE

### Before (8 Sections)
```
┌─────────────────────────────────────────────┐
│ Market Framework Tab                        │
├─────────────────────────────────────────────┤
│ ▼ Market Value Matrix Form                  │
│ ▼ Saved Matrix Reference Table              │
│ ▼ Show/Hide Advanced Row Editor             │
│ ▼ Role Library (Unified Table)              │
│ ▼ Review Queue Table                        │
│ ▼ Approved Library Table                    │
│ ▼ Auto-Resolved Table                       │
│ ▼ Standardized Role Catalog Table           │
│ ▼ Bulk Reassign Form                        │
└─────────────────────────────────────────────┘
```

### After (2 Tabs)
```
┌─────────────────────────────────────────────┐
│ Market Framework                            │
│ [Role Standardization] [Market Matrix]      │
├─────────────────────────────────────────────┤
│ IF Role Standardization:                    │
│ ┌─────────────────────────────────────────┐ │
│ │ [All][Needs Review][New][Auto][Learned]│ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Unified Role Table (1 table)        │ │ │
│ │ │ Raw|Suggested|Final|Status|Action  │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ IF Market Matrix:                            │
│ ┌─────────────────────────────────────────┐ │
│ │ Add Matrix Form                         │ │
│ │ Role [dropdown] T1-T4 [Save][Delete]   │ │
│ │ Saved Reference Table (existing only)   │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 🔌 API ENDPOINTS

### Existing (Unchanged)
```
GET  /market-matrix               
POST /market-matrix/role          
PUT  /market-matrix/:id           
DELETE /market-matrix/role/:role  

GET  /role-library/roles          
POST /role-library/roles          
PUT  /role-library/roles/:id      
GET  /role-library/analysis       
POST /role-library/approve        
PUT  /role-library/mappings/:id   
POST /role-library/mappings/reassign
```

### New
```
GET  /market-matrix/roles-without-matrices  ← Powers dropdown
```

---

## 🧭 COMPONENT DATA FLOW

### RoleStandardizationTab
```
useEffect (mount)
  ↓
refreshData()
  ├─ GET /role-library/analysis
  ├─ Parse: approved + auto + review
  └─ Set state: allRoles, roleCatalog, reviewDecisions

Render Table
  ↓
Filter by selectedStatus
  ↓
Admin clicks "Review"
  ├─ setEditingRaw = row.rawRole
  └─ Row becomes editable

Admin approves
  ↓
approveRole()
  ├─ POST /role-library/approve
  └─ refreshData() → React re-renders
```

### MarketMatrixTab
```
useEffect (mount)
  ↓
refreshData()
  ├─ GET /market-matrix
  ├─ GET /role-library/roles
  ├─ GET /market-matrix/roles-without-matrices ← New endpoint
  └─ Set state: matrixRows, rolesWithoutMatrices

Admin selects role
  ↓
setSelectedRole = "Community Manager"
  ↓
useEffect triggers
  ├─ Find existing matrix rows for that role
  └─ Populate matrixDraft with values or empty

Admin enters T1-T4 values
  ↓
setMatrixDraft({ T1: {...}, T2: {...}, ... })

Admin clicks "Save"
  ↓
saveMatrix(false)
  ├─ POST /market-matrix/role
  └─ refreshData() → Role disappears from dropdown
```

---

## 📊 STATE VARIABLES AT A GLANCE

### RoleStandardizationTab
| Variable | Type | Purpose |
|----------|------|---------|
| `allRoles` | RoleLibraryRow[] | All roles (approved + auto + review) |
| `roleCatalog` | RoleCatalogItem[] | Available standardized roles |
| `selectedStatus` | MatchStatus \| 'all' | Current filter |
| `editingRaw` | string \| null | Which row is editing |
| `editingValue` | string | Value being edited |
| `reviewDecisions` | Record<string, string> | Admin picks for Needs Review |
| `isSavingMapping` | boolean | API call in progress |

### MarketMatrixTab
| Variable | Type | Purpose |
|----------|------|---------|
| `matrixRows` | MatrixRow[] | All saved matrices |
| `selectedRole` | string | Role in edit form |
| `matrixDraft` | MatrixDraft | T1-T4 form values |
| `rolesWithoutMatrices` | RoleCatalogItem[] | Dropdown options |
| `isSavingMatrix` | boolean | API call in progress |
| `overwritePending` | boolean | Asking for confirmation |

---

## 🎨 CSS CLASSES USED

```
.stack                  ← grid container (gap: 16px)
.card                   ← white box (padding, border)
.sectionTitle           ← h2/h3 header
.sectionSubtitle        ← gray helper text
.tabNav                 ← tab button container
.tabButton              ← tab button (inactive)
.tabButtonActive        ← tab button (active, black)
.filterBar              ← status filter container
.filterButton           ← status filter button
.filterButtonActive     ← status filter active
.referenceTableWrap     ← table wrapper
.referenceTable         ← table element
.matrixInput            ← form input
.matrixRoleInput        ← role selector input
.smallButton            ← small action button
.dangerButton           ← delete button (red)
.errorBox               ← red error message
.successBox             ← green success message
.infoText               ← gray info text
```

---

## 🔍 DEBUGGING QUICK TIPS

| Problem | Check | Fix |
|---------|-------|-----|
| Role not in dropdown | Is it already in a matrix? | Delete matrix via API or reference table |
| Approval not saving | Does role name match catalog? | Check exact spelling in roleCatalog |
| Matrix form empty | Did refreshMatrix() load? | Check network tab, GET /market-matrix |
| Status filter stuck | Filter button stuck? | Click "All" to reset, check onClick handler |
| Approval creates dupe | Admin entered uncased role? | System normalizes role names (lowercase) |

---

## ✨ WHAT CHANGED FOR ADMINS

| Task | Before | After |
|------|--------|-------|
| Clean roles | Jump between 5 tables | 1 unified table |
| Add matrix | Free text autocomplete | Curated dropdown |
| Edit matrix | 2 ways (form + editor) | 1 clear way (form) |
| Find approved roles | Look in Approved Library | In unified table, "Learned" status |
| Find auto-matched | Look in Auto-Resolved | In unified table, "Auto-Matched" status |
| Remove matrix | Delete in reference table | Click Delete in reference |

---

## 📚 DOCUMENTATION FILES

| File | Audience | Content |
|------|----------|---------|
| `MARKET_FRAMEWORK_EXECUTIVE_SUMMARY.md` | Everyone | Answers to all 6 questions |
| `MARKET_FRAMEWORK_BEFORE_AFTER.md` | PM/Manager | Visual comparison, benefits |
| `MARKET_FRAMEWORK_DEVELOPER_GUIDE.md` | Developers | Code, APIs, state, testing |
| `MARKET_FRAMEWORK_REFACTOR_SUMMARY.md` | Technical | Detailed breakdown, file manifest |
| `MARKET_FRAMEWORK_QUICK_REFERENCE.md` | Everyone | This file |

---

## 🚀 QUICK START FOR DEVS

1. **To understand the flow:**
   ```
   Read: MARKET_FRAMEWORK_BEFORE_AFTER.md
   ```

2. **To add a feature:**
   ```
   Read: MARKET_FRAMEWORK_DEVELOPER_GUIDE.md
   Edit: RoleStandardizationTab.tsx OR MarketMatrixTab.tsx
   ```

3. **To debug an issue:**
   ```
   Check: State variables (above)
   Check: API endpoints (above)
   Check: Network tab in DevTools
   Read: Debugging Tips (above)
   ```

4. **To test changes:**
   ```
   npm run dev:api
   npm run dev:web
   Open: http://localhost:5173
   Go to: Admin Console → Market Framework
   ```

---

## 🎯 MISSION ACCOMPLISHED

✅ From 8 fragmented sections → 2 focused tabs
✅ From confusing UX → business-first workflow
✅ From backend-concepts → admin concepts
✅ From system-first → admin-friendly
✅ Zero data loss, zero migrations needed
✅ All intelligence preserved
✅ Ready to deploy

**Status: COMPLETE ✨**
