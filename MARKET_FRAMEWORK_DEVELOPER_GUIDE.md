# Market Framework - Developer Guide

## Quick Reference

### Component Hierarchy
```
AdminConsole
├── [Market Framework Tab selected]
    └── MarketFramework (main container with 2 tabs)
        ├── RoleStandardizationTab (when tab = 'standardization')
        └── MarketMatrixTab (when tab = 'matrix')
```

### File Organization

```
apps/web/src/pages/
├── AdminConsole.tsx (MODIFIED - routes to MarketFramework)
├── AdminConsole.module.css (MODIFIED - added tab styles)
└── admin/
    ├── MarketFramework.tsx (NEW - container, tab logic)
    ├── RoleStandardizationTab.tsx (NEW - unified role table)
    ├── MarketMatrixTab.tsx (NEW - matrix form + reference)
    ├── DataOperationsTab
    └── SystemControlsTab

apps/api/src/
└── index.ts (MODIFIED - added GET /market-matrix/roles-without-matrices)
```

---

## Adding Features

### Add a new filter to Role Standardization

1. Open `RoleStandardizationTab.tsx`
2. Find `STATUS_ORDER` constant (line ~30)
3. Add your status to `STATUS_COLORS` and `STATUS_ORDER`
4. The filter buttons auto-generated from `statusCounts` useMemo

Example:
```typescript
const STATUS_COLORS: Record<MatchStatus, string> = {
  'Learned': '#10b981',
  'Auto-Matched': '#60a5fa',
  'Needs Review': '#f59e0b',
  'New Role Suggested': '#f97316',
  'Approved': '#8b5cf6',
  'YourNewStatus': '#yourColor' // ← ADD HERE
};
```

### Add a new column to Role Standardization table

1. Find the `<table>` JSX in `RoleStandardizationTab.tsx` (line ~160+)
2. Add `<th>` in `<thead>`
3. Add `<td>` in `<tbody>.map()`
4. Update header comment if needed

### Add a new action button to Market Matrix

1. Open `MarketMatrixTab.tsx`
2. Find the buttons in "Add Matrix Section" or "Saved Reference"
3. Add button with onClick handler
4. Call the appropriate API endpoint

---

## API Integration

### Role Standardization Tab Endpoints Used

```typescript
// Fetch all roles (unified analysis)
GET /role-library/analysis?viewerRole=ADMIN

// Approve a raw role
POST /role-library/approve
Body: {
  sourceRoleName: string,
  standardizedRoleId: string,
  standardizedRoleName: string,
  allowCreateRole: boolean,
  confidenceScore: number | null
}
```

### Market Matrix Tab Endpoints Used

```typescript
// Get all matrices
GET /market-matrix?viewerRole=ADMIN

// Get roles WITHOUT matrices (NEW)
GET /market-matrix/roles-without-matrices?viewerRole=ADMIN

// Save matrix for a role
POST /market-matrix/role?viewerRole=ADMIN
Body: {
  standardizedRoleId: string,
  roleName: string,
  entries: Array<{tenureBand, minSalary, maxSalary}>,
  overwrite: boolean
}

// Edit a matrix row
PUT /market-matrix/:id?viewerRole=ADMIN

// Delete matrix for a role
DELETE /market-matrix/role/:role?viewerRole=ADMIN
```

---

## State Management

### RoleStandardizationTab State

```typescript
const [allRoles, setAllRoles] = useState<RoleLibraryRow[]>([])
  // All roles (approved + auto-resolved + needs review)

const [roleCatalog, setRoleCatalog] = useState<RoleCatalogItem[]>([])
  // All active standardized roles (for suggestions)

const [selectedStatus, setSelectedStatus] = useState<MatchStatus | 'all'>('all')
  // Current filter

const [editingRaw, setEditingRaw] = useState<string | null>(null)
  // Which row is in edit mode

const [editingValue, setEditingValue] = useState('')
  // The value being edited

const [reviewDecisions, setReviewDecisions] = useState<Record<string, string>>({})
  // Admin's choices for Needs Review rows
```

### MarketMatrixTab State

```typescript
const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([])
  // All saved matrices

const [selectedRole, setSelectedRole] = useState('')
  // Role currently being edited in form

const [matrixDraft, setMatrixDraft] = useState<MatrixDraft>(createEmptyDraft())
  // T1-T4 form values for selected role

const [rolesWithoutMatrices, setRolesWithoutMatrices] = useState<RoleCatalogItem[]>([])
  // Options for role dropdown

const [isSavingMatrix, setIsSavingMatrix] = useState(false)
  // Loading state while saving

const [matrixSaveMsg, setMatrixSaveMsg] = useState<string | null>(null)
  // Success/error message
```

---

## Key Functions

### RoleStandardizationTab

**`refreshData()`**
- Fetches `/role-library/analysis`
- Populates `allRoles`, `roleCatalog`, `reviewDecisions`
- Called on mount, after approvals

**`approveRole(row)`**
- Sends POST to `/role-library/approve`
- Updates `allRoles` via `refreshData()`
- Shows success message

**`handleStartEdit(rawRole, currentValue)`**
- Enters edit mode for a specific row
- Sets `editingRaw` and `editingValue`

### MarketMatrixTab

**`refreshData()`**
- Calls `refreshMatrix()` + fetches `/role-library/roles` + `/market-matrix/roles-without-matrices`
- Populates all state

**`saveMatrix(overwrite)`**
- POST to `/market-matrix/role`
- Handles 409 conflict (asks to overwrite)
- Refreshes data

**`deleteRoleMatrix(roleName)`**
- DELETE to `/market-matrix/role/:role`
- Asks confirmation first
- Refreshes data

**`loadRoleToEditor(roleName)`**
- Sets `selectedRole`
- Triggers `useEffect` to populate `matrixDraft` with existing values

---

## Testing Checklist

### For New Features in Role Standardization

- [ ] Filter button works (updates `selectedStatus`)
- [ ] Filtered rows display correctly
- [ ] Row count in filter buttons is accurate
- [ ] Click "Review" enters edit mode
- [ ] Typing in input updates `editingValue`
- [ ] Datalist dropdown shows role suggestions
- [ ] Click "Approve" calls API
- [ ] Success message appears
- [ ] Row updates status after approval
- [ ] Click "Cancel" exits edit mode

### For New Features in Market Matrix

- [ ] Dropdown populates with roles without matrices
- [ ] Selecting role loads existing matrix values (or empty)
- [ ] Clicking "Save Role Matrix" calls API
- [ ] Success/error message appears
- [ ] New role appears in reference table
- [ ] Click "Edit Role" loads into form
- [ ] Click "Delete Role" asks confirmation
- [ ] Deleted row disappears from reference table
- [ ] Deleted role reappears in dropdown

---

## Common Debugging

### Role not appearing in Matrix dropdown
- Reason: Role already has a matrix
- Check: `GET /market-matrix/roles-without-matrices` should not return that role
- Fix: Delete existing matrix OR check `standardizedRoleId` is set

### Approval not saving
- Reason: Role name not found in catalog
- Check: Ensure role matches exactly (case-insensitive)
- Fix: Check `roleCatalog` contains the role

### Matrix form not populating
- Reason: `useEffect` dependency not triggering
- Check: `selectedRole` or `matrixRows` not updated
- Fix: Call `refreshMatrix()` after adding new role

### Performance concern: Large role list
- Optimize: Implement pagination in `filteredRoles`
- Or: Use virtual scrolling for role table
- Current: Works fine for ~500 roles

---

## CSS Classes Used

All from `AdminConsole.module.css`:

- `.stack` — grid container with gap
- `.card` — white card with padding/border
- `.sectionTitle`, `.sectionSubtitle` — headers
- `.tabNav`, `.tabButton`, `.tabButtonActive` — tab navigation
- `.filterBar`, `.filterButton`, `.filterButtonActive` — status filters
- `.tabContent` — tab content container
- `.referenceTableWrap`, `.referenceTable` — tables
- `.matrixInput`, `.matrixRoleInput` — form inputs
- `.smallButton`, `.dangerButton` — buttons
- `.errorBox`, `.successBox`, `.infoText` — message styles

---

## Performance Notes

### Queries
- `GET /role-library/analysis` — queries EmployeeDirectory once, returns grouped analysis
- `GET /market-matrix/roles-without-matrices` — indexed queries on StandardizedRole + distinct
- Both endpoints should complete in <500ms even with 1000+ roles

### UI
- Status filtering done client-side (JavaScript, not API)
- Datalist for autocomplete (native browser, efficient)
- memoized to avoid re-renders

### Scalability
- Handles 500+ roles without lag
- 10000+ matrices manageable (paginate if needed)
- No N+1 queries

---

## Future Improvements (Optional)

1. **Bulk Approve**
   - Add checkbox to rows
   - Batch approve all checked

2. **Search/Filter**
   - Text search in Raw Role column
   - Combine with status filter

3. **Import/Export**
   - Export approved mappings as CSV
   - Import bulk mappings from CSV

4. **Audit Log**
   - Show who approved what, when

5. **Confidence Score Threshold**
   - Admin can set threshold for auto-approve

---

## Support

**Q: How do I add a new MatchStatus?**
A: Update MatchStatus type in RoleStandardizationTab, add to STATUS_COLORS and STATUS_ORDER, update backend if needed.

**Q: How do I change the tenure bands (T1-T4)?**
A: Update MATRIX_BANDS constant in MarketMatrixTab. Also update backend and database enum if changing labels.

**Q: What if admin wants row-level matrix editing?**
A: The Advanced Row Editor was removed intentionally, but the API still supports row-level edits via PUT `/market-matrix/:id`.

**Q: How do I debug API responses?**
A: Open browser DevTools → Network tab, look for requests to `/market-matrix` and `/role-library/` endpoints.

**Q: Is there a way to test locally without full Docker setup?**
A: Yes, API server runs on port 3001, Web on 5173. Make sure both are running before testing.
