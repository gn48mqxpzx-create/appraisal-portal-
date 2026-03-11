import { useEffect, useMemo, useState } from 'react';
import styles from '../AdminConsole.module.css';

const MATRIX_BANDS = [
  { key: 'T1', label: 'T1 - < 1 Year' },
  { key: 'T2', label: 'T2 - 1 Year' },
  { key: 'T3', label: 'T3 - 2-3 Years' },
  { key: 'T4', label: 'T4 - 4-5 Years' }
] as const;

type TenureBand = (typeof MATRIX_BANDS)[number]['key'];

type MatrixDraft = Record<TenureBand, { minSalary: string; maxSalary: string }>;

type MatrixRow = {
  id: string;
  standardizedRoleId: string;
  roleName: string;
  tenureBand: TenureBand;
  minSalary: number | string;
  maxSalary: number | string;
};

type RoleCatalogItem = {
  id: string;
  roleName: string;
  isActive: boolean;
};

type RoleLibraryRow = {
  id?: string;
  rawRole: string;
  suggestedStandardRole: string | null;
  finalStandardRole: string | null;
  matchStatus: 'Learned' | 'Auto-Matched' | 'Needs Review' | 'New Role Suggested' | 'Approved';
  matchSource: 'SAVED_RULE' | 'AUTO_SIMILARITY' | 'NEW_ROLE_SUGGESTION' | 'ADMIN_CONFIRMED';
  confidenceScore?: number | null;
  standardizedRoleSuggestion?: string;
  standardizedRoleId?: string;
};

const createEmptyDraft = (): MatrixDraft => ({
  T1: { minSalary: '', maxSalary: '' },
  T2: { minSalary: '', maxSalary: '' },
  T3: { minSalary: '', maxSalary: '' },
  T4: { minSalary: '', maxSalary: '' }
});

const normalize = (value: string) => value.trim().toLowerCase();

export function MarketFrameworkTab() {
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [matrixDraft, setMatrixDraft] = useState<MatrixDraft>(createEmptyDraft());
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);
  const [matrixSaveMsg, setMatrixSaveMsg] = useState<string | null>(null);
  const [overwritePending, setOverwritePending] = useState(false);
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  const [showAdvancedMatrix, setShowAdvancedMatrix] = useState(false);

  const [rowDrafts, setRowDrafts] = useState<Record<string, { roleName: string; tenureBand: TenureBand; minSalary: string; maxSalary: string }>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const [roleCatalog, setRoleCatalog] = useState<RoleCatalogItem[]>([]);
  const [reviewQueue, setReviewQueue] = useState<RoleLibraryRow[]>([]);
  const [approvedLibrary, setApprovedLibrary] = useState<RoleLibraryRow[]>([]);
  const [autoResolved, setAutoResolved] = useState<RoleLibraryRow[]>([]);
  const [unifiedRoleLibrary, setUnifiedRoleLibrary] = useState<RoleLibraryRow[]>([]);

  const [reviewDecisions, setReviewDecisions] = useState<Record<string, string>>({});
  const [approvedOverrides, setApprovedOverrides] = useState<Record<string, string>>({});
  const [isSavingMapping, setIsSavingMapping] = useState(false);

  const [reassignFromRoleId, setReassignFromRoleId] = useState('');
  const [reassignToRoleId, setReassignToRoleId] = useState('');

  const selectedCatalogRole = useMemo(
    () => roleCatalog.find((role) => normalize(role.roleName) === normalize(selectedRole)) ?? null,
    [roleCatalog, selectedRole]
  );

  const roleCatalogOptions = useMemo(
    () => roleCatalog.slice().sort((a, b) => a.roleName.localeCompare(b.roleName)),
    [roleCatalog]
  );

  const refreshMatrix = async () => {
    const response = await fetch('http://localhost:3001/market-matrix?viewerRole=ADMIN');
    const payload = await response.json();
    setMatrixRows(Array.isArray(payload?.data) ? payload.data : []);
  };

  const refreshRoleLibrary = async () => {
    const response = await fetch('http://localhost:3001/role-library/analysis?viewerRole=ADMIN');
    const payload = await response.json();
    const data = payload?.data || {};

    setRoleCatalog(Array.isArray(data.roleCatalog) ? data.roleCatalog : []);
    setReviewQueue(Array.isArray(data.reviewQueue) ? data.reviewQueue : []);
    setApprovedLibrary(Array.isArray(data.approvedLibrary) ? data.approvedLibrary : []);
    setAutoResolved(Array.isArray(data.autoResolved) ? data.autoResolved : []);
    setUnifiedRoleLibrary(Array.isArray(data.unifiedTable) ? data.unifiedTable : []);

    const nextReviewDecisions: Record<string, string> = {};
    (Array.isArray(data.reviewQueue) ? data.reviewQueue : []).forEach((row: RoleLibraryRow) => {
      nextReviewDecisions[row.rawRole] = row.suggestedStandardRole || row.standardizedRoleSuggestion || '';
    });
    setReviewDecisions(nextReviewDecisions);

    const nextApprovedOverrides: Record<string, string> = {};
    (Array.isArray(data.approvedLibrary) ? data.approvedLibrary : []).forEach((row: RoleLibraryRow) => {
      if (row.id && row.standardizedRoleId) {
        nextApprovedOverrides[row.id] = row.standardizedRoleId;
      }
    });
    setApprovedOverrides(nextApprovedOverrides);
  };

  useEffect(() => {
    void refreshMatrix();
    void refreshRoleLibrary();
  }, []);

  useEffect(() => {
    if (!selectedRole.trim()) {
      setMatrixDraft(createEmptyDraft());
      setOverwritePending(false);
      return;
    }

    const rowsForRole = matrixRows.filter((row) => normalize(row.roleName) === normalize(selectedRole));
    const next = createEmptyDraft();
    rowsForRole.forEach((row) => {
      next[row.tenureBand] = {
        minSalary: String(row.minSalary),
        maxSalary: String(row.maxSalary)
      };
    });

    setMatrixDraft(next);
    setOverwritePending(false);
  }, [selectedRole, matrixRows]);

  useEffect(() => {
    const nextDrafts: Record<string, { roleName: string; tenureBand: TenureBand; minSalary: string; maxSalary: string }> = {};
    matrixRows.forEach((row) => {
      nextDrafts[row.id] = {
        roleName: row.roleName,
        tenureBand: row.tenureBand,
        minSalary: String(row.minSalary),
        maxSalary: String(row.maxSalary)
      };
    });
    setRowDrafts(nextDrafts);
  }, [matrixRows]);

  const saveMatrix = async (overwrite: boolean) => {
    if (!selectedRole.trim() || isSavingMatrix || isDeletingRole) {
      return;
    }

    setIsSavingMatrix(true);
    setMatrixSaveMsg(null);

    try {
      const entries = MATRIX_BANDS.map((band) => ({
        tenureBand: band.key,
        minSalary: parseFloat(matrixDraft[band.key].minSalary),
        maxSalary: parseFloat(matrixDraft[band.key].maxSalary)
      })).filter((entry) => Number.isFinite(entry.minSalary) && Number.isFinite(entry.maxSalary));

      const response = await fetch('http://localhost:3001/market-matrix/role?viewerRole=ADMIN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standardizedRoleId: selectedCatalogRole?.id,
          roleName: selectedRole.trim(),
          entries,
          overwrite
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.requiresOverwrite) {
        setOverwritePending(true);
        setMatrixSaveMsg('This role already has saved matrix values. Confirm overwrite to update existing values.');
        return;
      }

      if (!response.ok) {
        setMatrixSaveMsg(payload?.error || 'Failed to save matrix values');
        return;
      }

      setOverwritePending(false);
      setMatrixSaveMsg(overwrite ? 'Existing matrix values overwritten successfully.' : 'Matrix values saved successfully.');
      await refreshMatrix();
      await refreshRoleLibrary();
    } catch {
      setMatrixSaveMsg('Failed to save matrix values');
    } finally {
      setIsSavingMatrix(false);
    }
  };

  const loadRoleToEditor = (roleName: string) => {
    setSelectedRole(roleName);
    setMatrixSaveMsg(null);
    setOverwritePending(false);
  };

  const deleteRoleMatrix = async (roleName: string) => {
    if (!roleName.trim() || isDeletingRole) {
      return;
    }

    const confirmed = window.confirm(`Delete all matrix rows for "${roleName}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setIsDeletingRole(true);
    setMatrixSaveMsg(null);

    try {
      const response = await fetch(`http://localhost:3001/market-matrix/role/${encodeURIComponent(roleName)}?viewerRole=ADMIN`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMatrixSaveMsg(payload?.error || 'Failed to delete role matrix');
        return;
      }

      if (normalize(selectedRole) === normalize(roleName)) {
        setSelectedRole('');
      }
      setOverwritePending(false);
      setMatrixSaveMsg(`Deleted all matrix rows for ${roleName}.`);
      await refreshMatrix();
    } catch {
      setMatrixSaveMsg('Failed to delete role matrix');
    } finally {
      setIsDeletingRole(false);
    }
  };

  const saveRow = async (rowId: string) => {
    const draft = rowDrafts[rowId];
    if (!draft || savingRowId || deletingRowId) {
      return;
    }

    setSavingRowId(rowId);
    setMatrixSaveMsg(null);

    try {
      const roleFromCatalog = roleCatalog.find((role) => normalize(role.roleName) === normalize(draft.roleName));

      const response = await fetch(`http://localhost:3001/market-matrix/${rowId}?viewerRole=ADMIN`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standardizedRoleId: roleFromCatalog?.id,
          roleName: draft.roleName.trim(),
          tenureBand: draft.tenureBand,
          minSalary: Number(draft.minSalary),
          maxSalary: Number(draft.maxSalary)
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMatrixSaveMsg(payload?.error || 'Failed to update matrix row');
        return;
      }

      setMatrixSaveMsg('Matrix row updated successfully.');
      await refreshMatrix();
      await refreshRoleLibrary();
    } catch {
      setMatrixSaveMsg('Failed to update matrix row');
    } finally {
      setSavingRowId(null);
    }
  };

  const deleteRow = async (rowId: string, roleName: string, tenureBand: TenureBand) => {
    if (savingRowId || deletingRowId) {
      return;
    }

    const confirmed = window.confirm(`Delete ${roleName} (${tenureBand}) row? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setDeletingRowId(rowId);
    setMatrixSaveMsg(null);

    try {
      const response = await fetch(`http://localhost:3001/market-matrix/${rowId}?viewerRole=ADMIN`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMatrixSaveMsg(payload?.error || 'Failed to delete matrix row');
        return;
      }

      setMatrixSaveMsg(`Deleted row ${roleName} (${tenureBand}).`);
      await refreshMatrix();
      await refreshRoleLibrary();
    } catch {
      setMatrixSaveMsg('Failed to delete matrix row');
    } finally {
      setDeletingRowId(null);
    }
  };

  const approveReviewItem = async (row: RoleLibraryRow) => {
    if (isSavingMapping) {
      return;
    }

    const chosenRoleName = (reviewDecisions[row.rawRole] || row.suggestedStandardRole || row.standardizedRoleSuggestion || '').trim();
    if (!chosenRoleName) {
      return;
    }

    const matchedRole = roleCatalog.find((role) => normalize(role.roleName) === normalize(chosenRoleName));

    setIsSavingMapping(true);
    try {
      const response = await fetch('http://localhost:3001/role-library/approve?viewerRole=ADMIN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRoleName: row.rawRole,
          standardizedRoleId: matchedRole?.id,
          standardizedRoleName: chosenRoleName,
          allowCreateRole: !matchedRole,
          confidenceScore: row.confidenceScore ?? null
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMatrixSaveMsg(payload?.error || 'Failed to approve role mapping');
        return;
      }

      await refreshRoleLibrary();
      setMatrixSaveMsg(`Approved mapping for ${row.rawRole}.`);
    } catch {
      setMatrixSaveMsg('Failed to approve role mapping');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const saveApprovedMappingEdit = async (row: RoleLibraryRow) => {
    if (!row.id || isSavingMapping) {
      return;
    }

    const targetRoleId = approvedOverrides[row.id];
    if (!targetRoleId) {
      return;
    }

    setIsSavingMapping(true);
    try {
      const response = await fetch(`http://localhost:3001/role-library/mappings/${row.id}?viewerRole=ADMIN`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standardizedRoleId: targetRoleId })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMatrixSaveMsg(payload?.error || 'Failed to update approved mapping');
        return;
      }

      await refreshRoleLibrary();
      setMatrixSaveMsg(`Updated mapping for ${row.rawRole}.`);
    } catch {
      setMatrixSaveMsg('Failed to update approved mapping');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const setRoleActiveState = async (roleId: string, isActive: boolean) => {
    if (isSavingMapping) {
      return;
    }

    setIsSavingMapping(true);
    try {
      const response = await fetch(`http://localhost:3001/role-library/roles/${roleId}?viewerRole=ADMIN`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMatrixSaveMsg(payload?.error || 'Failed to update role status');
        return;
      }

      await refreshRoleLibrary();
      setMatrixSaveMsg(isActive ? 'Role activated.' : 'Role deactivated.');
    } catch {
      setMatrixSaveMsg('Failed to update role status');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const reassignMappings = async () => {
    if (!reassignFromRoleId || !reassignToRoleId || reassignFromRoleId === reassignToRoleId || isSavingMapping) {
      return;
    }

    setIsSavingMapping(true);
    try {
      const response = await fetch('http://localhost:3001/role-library/mappings/reassign?viewerRole=ADMIN', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromRoleId: reassignFromRoleId,
          toRoleId: reassignToRoleId
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMatrixSaveMsg(payload?.error || 'Failed to reassign mappings');
        return;
      }

      await refreshRoleLibrary();
      setMatrixSaveMsg('Role mappings reassigned successfully.');
    } catch {
      setMatrixSaveMsg('Failed to reassign mappings');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const groupedMatrixRows = useMemo(() => {
    const grouped: Record<string, MatrixRow[]> = {};
    matrixRows.forEach((row) => {
      if (!grouped[row.roleName]) {
        grouped[row.roleName] = [];
      }
      grouped[row.roleName].push(row);
    });

    Object.values(grouped).forEach((rows) => rows.sort((a, b) => a.tenureBand.localeCompare(b.tenureBand)));
    return grouped;
  }, [matrixRows]);

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Market Value Matrix</h2>
            <p className={styles.sectionSubtitle}>Role-first matrix management linked to standardized role library.</p>
          </div>
          <div className={styles.inlineActions}>
            <button
              type="button"
              onClick={() => void saveMatrix(false)}
              disabled={!selectedRole.trim() || isSavingMatrix || isDeletingRole}
              className={`${styles.syncButton} ${(!selectedRole.trim() || isSavingMatrix || isDeletingRole) ? styles.syncButtonDisabled : ''}`.trim()}
            >
              {isSavingMatrix ? 'Saving...' : 'Save Role Matrix'}
            </button>
            {overwritePending && (
              <button
                type="button"
                onClick={() => void saveMatrix(true)}
                disabled={isSavingMatrix}
                className={`${styles.syncButton} ${isSavingMatrix ? styles.syncButtonDisabled : ''}`.trim()}
              >
                Confirm Overwrite
              </button>
            )}
            <button
              type="button"
              onClick={() => void deleteRoleMatrix(selectedRole.trim())}
              disabled={!selectedRole.trim() || isSavingMatrix || isDeletingRole}
              className={`${styles.smallButton} ${styles.dangerButton}`}
            >
              {isDeletingRole ? 'Deleting...' : 'Delete Role Matrix'}
            </button>
          </div>
        </div>

        <div className={styles.matrixRoleRow}>
          <label htmlFor="matrix-role" className={styles.matrixRoleLabel}>Standardized Role</label>
          <input
            id="matrix-role"
            type="text"
            list="matrix-role-options"
            value={selectedRole}
            onChange={(event) => {
              setSelectedRole(event.target.value);
              setMatrixSaveMsg(null);
            }}
            className={styles.matrixRoleInput}
            placeholder="Type or select a standardized role"
          />
          <datalist id="matrix-role-options">
            {roleCatalogOptions.filter((role) => role.isActive).map((role) => (
              <option key={role.id} value={role.roleName} />
            ))}
          </datalist>
        </div>

        <div className={styles.matrixTableWrapper}>
          <table className={styles.matrixTable}>
            <thead>
              <tr className={styles.matrixHead}>
                <th className={styles.matrixThBand}>Tenure Band</th>
                <th className={styles.matrixTh}>Min Salary</th>
                <th className={styles.matrixTh}>Max Salary</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX_BANDS.map((band) => (
                <tr key={band.key} className={styles.matrixRow}>
                  <td className={styles.matrixTdBand}>{band.label}</td>
                  <td className={styles.matrixTd}>
                    <input
                      type="number"
                      aria-label={`${band.label} minimum salary`}
                      min={0}
                      step={100}
                      value={matrixDraft[band.key].minSalary}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMatrixDraft((prev) => ({
                          ...prev,
                          [band.key]: {
                            ...prev[band.key],
                            minSalary: value
                          }
                        }));
                      }}
                      className={styles.matrixInput}
                    />
                  </td>
                  <td className={styles.matrixTd}>
                    <input
                      type="number"
                      aria-label={`${band.label} maximum salary`}
                      min={0}
                      step={100}
                      value={matrixDraft[band.key].maxSalary}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMatrixDraft((prev) => ({
                          ...prev,
                          [band.key]: {
                            ...prev[band.key],
                            maxSalary: value
                          }
                        }));
                      }}
                      className={styles.matrixInput}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {matrixSaveMsg && (
          <p className={matrixSaveMsg.toLowerCase().includes('failed') ? styles.errorText : styles.matrixSuccess}>{matrixSaveMsg}</p>
        )}
      </section>

      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Saved Matrix Reference</h3>
        <p className={styles.sectionSubtitle}>Primary role-based matrix maintenance view.</p>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Role</th>
                <th>T1</th>
                <th>T2</th>
                <th>T3</th>
                <th>T4</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedMatrixRows).map(([roleName, rows]) => {
                const byBand = Object.fromEntries(rows.map((row) => [row.tenureBand, row]));
                return (
                  <tr key={roleName}>
                    <td>{roleName}</td>
                    {MATRIX_BANDS.map((band) => {
                      const row = byBand[band.key as TenureBand];
                      return (
                        <td key={band.key}>
                          {row ? `${Number(row.minSalary).toLocaleString()} - ${Number(row.maxSalary).toLocaleString()}` : '-'}
                        </td>
                      );
                    })}
                    <td className={styles.referenceActionsCell}>
                      <button type="button" className={styles.smallButton} onClick={() => loadRoleToEditor(roleName)}>
                        Edit Role
                      </button>
                      <button
                        type="button"
                        className={`${styles.smallButton} ${styles.dangerButton}`}
                        onClick={() => void deleteRoleMatrix(roleName)}
                      >
                        Delete Role
                      </button>
                    </td>
                  </tr>
                );
              })}
              {Object.keys(groupedMatrixRows).length === 0 && (
                <tr>
                  <td colSpan={6}>No matrix values saved yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.inlineActions}>
          <button type="button" className={styles.smallButton} onClick={() => setShowAdvancedMatrix((prev) => !prev)}>
            {showAdvancedMatrix ? 'Hide Advanced Row Editor' : 'Show Advanced Row Editor'}
          </button>
        </div>

        {showAdvancedMatrix && (
          <div className={styles.referenceTableWrap}>
            <table className={styles.referenceTable}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Band</th>
                  <th>Min Salary</th>
                  <th>Max Salary</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => {
                  const rowDraft = rowDrafts[row.id] || {
                    roleName: row.roleName,
                    tenureBand: row.tenureBand,
                    minSalary: String(row.minSalary),
                    maxSalary: String(row.maxSalary)
                  };

                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="text"
                          className={styles.matrixInput}
                          aria-label={`Role name for row ${row.id}`}
                          value={rowDraft.roleName}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRowDrafts((prev) => ({
                              ...prev,
                              [row.id]: {
                                ...rowDraft,
                                roleName: value
                              }
                            }));
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className={styles.mappingSelect}
                          aria-label={`Tenure band for row ${row.id}`}
                          value={rowDraft.tenureBand}
                          onChange={(event) => {
                            const value = event.target.value as TenureBand;
                            setRowDrafts((prev) => ({
                              ...prev,
                              [row.id]: {
                                ...rowDraft,
                                tenureBand: value
                              }
                            }));
                          }}
                        >
                          {MATRIX_BANDS.map((band) => (
                            <option key={`${row.id}-${band.key}`} value={band.key}>
                              {band.key}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          className={styles.matrixInput}
                          aria-label={`Minimum salary for row ${row.id}`}
                          value={rowDraft.minSalary}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRowDrafts((prev) => ({
                              ...prev,
                              [row.id]: {
                                ...rowDraft,
                                minSalary: value
                              }
                            }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          className={styles.matrixInput}
                          aria-label={`Maximum salary for row ${row.id}`}
                          value={rowDraft.maxSalary}
                          onChange={(event) => {
                            const value = event.target.value;
                            setRowDrafts((prev) => ({
                              ...prev,
                              [row.id]: {
                                ...rowDraft,
                                maxSalary: value
                              }
                            }));
                          }}
                        />
                      </td>
                      <td className={styles.referenceActionsCell}>
                        <button
                          type="button"
                          className={styles.smallButton}
                          disabled={Boolean(savingRowId || deletingRowId)}
                          onClick={() => void saveRow(row.id)}
                        >
                          {savingRowId === row.id ? 'Saving...' : 'Save Row'}
                        </button>
                        <button
                          type="button"
                          className={`${styles.smallButton} ${styles.dangerButton}`}
                          disabled={Boolean(savingRowId || deletingRowId)}
                          onClick={() => void deleteRow(row.id, row.roleName, row.tenureBand)}
                        >
                          {deletingRowId === row.id ? 'Deleting...' : 'Delete Row'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {matrixRows.length === 0 && (
                  <tr>
                    <td colSpan={5}>No matrix rows to manage yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Role Library</h2>
        <p className={styles.sectionSubtitle}>Unified intelligent role engine with review queue, approved library, and auto-resolved roles.</p>

        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Raw Role</th>
                <th>Suggested Standard Role</th>
                <th>Final Standard Role</th>
                <th>Match Status</th>
                <th>Match Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {unifiedRoleLibrary.map((row) => {
                const needsAction = row.matchStatus === 'Needs Review' || row.matchStatus === 'New Role Suggested';
                const value = reviewDecisions[row.rawRole] || row.finalStandardRole || row.suggestedStandardRole || '';

                return (
                  <tr key={`${row.rawRole}-${row.id || row.matchStatus}`}>
                    <td>{row.rawRole}</td>
                    <td>{row.suggestedStandardRole || row.standardizedRoleSuggestion || '-'}</td>
                    <td>
                      {needsAction ? (
                        <input
                          type="text"
                          className={styles.matrixInput}
                          aria-label={`Final role for ${row.rawRole}`}
                          list="role-library-options"
                          value={value}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setReviewDecisions((prev) => ({ ...prev, [row.rawRole]: nextValue }));
                          }}
                        />
                      ) : (
                        row.finalStandardRole || '-'
                      )}
                    </td>
                    <td>{row.matchStatus}</td>
                    <td>{row.matchSource}</td>
                    <td>
                      {needsAction ? (
                        <button
                          type="button"
                          className={styles.smallButton}
                          disabled={isSavingMapping}
                          onClick={() => void approveReviewItem(row)}
                        >
                          Approve
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
              {unifiedRoleLibrary.length === 0 && (
                <tr>
                  <td colSpan={6}>No role library entries available yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          <datalist id="role-library-options">
            {roleCatalogOptions.map((role) => (
              <option key={role.id} value={role.roleName} />
            ))}
          </datalist>
        </div>

        <h3 className={styles.sectionTitle}>Review Queue</h3>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Raw Role</th>
                <th>Suggested</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reviewQueue.map((row) => (
                <tr key={`review-${row.rawRole}`}>
                  <td>{row.rawRole}</td>
                  <td>{row.suggestedStandardRole || row.standardizedRoleSuggestion || '-'}</td>
                  <td>{typeof row.confidenceScore === 'number' ? row.confidenceScore.toFixed(3) : '-'}</td>
                  <td>{row.matchStatus}</td>
                </tr>
              ))}
              {reviewQueue.length === 0 && (
                <tr>
                  <td colSpan={4}>No roles in review queue.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className={styles.sectionTitle}>Approved Library</h3>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Raw Role</th>
                <th>Current Standard Role</th>
                <th>Reassign To</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {approvedLibrary.map((row) => (
                <tr key={row.id || row.rawRole}>
                  <td>{row.rawRole}</td>
                  <td>{row.finalStandardRole || '-'}</td>
                  <td>
                    <select
                      className={styles.mappingSelect}
                      aria-label={`Reassign mapping for ${row.rawRole}`}
                      value={(row.id && approvedOverrides[row.id]) || ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!row.id) {
                          return;
                        }
                        setApprovedOverrides((prev) => ({ ...prev, [row.id as string]: value }));
                      }}
                    >
                      <option value="">Select standardized role</option>
                      {roleCatalogOptions.map((role) => (
                        <option key={`${row.rawRole}-${role.id}`} value={role.id}>
                          {role.roleName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.smallButton}
                      disabled={!row.id || isSavingMapping}
                      onClick={() => void saveApprovedMappingEdit(row)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
              {approvedLibrary.length === 0 && (
                <tr>
                  <td colSpan={4}>No approved mappings yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className={styles.sectionTitle}>Auto-Resolved</h3>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Raw Role</th>
                <th>Resolved Role</th>
                <th>Confidence</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {autoResolved.map((row) => (
                <tr key={`auto-${row.rawRole}`}>
                  <td>{row.rawRole}</td>
                  <td>{row.finalStandardRole || row.suggestedStandardRole || '-'}</td>
                  <td>{typeof row.confidenceScore === 'number' ? row.confidenceScore.toFixed(3) : '-'}</td>
                  <td>{row.matchSource}</td>
                </tr>
              ))}
              {autoResolved.length === 0 && (
                <tr>
                  <td colSpan={4}>No auto-resolved roles at this time.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className={styles.sectionTitle}>Standardized Role Catalog</h3>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {roleCatalogOptions.map((role) => (
                <tr key={role.id}>
                  <td>{role.roleName}</td>
                  <td>{role.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button
                      type="button"
                      className={`${styles.smallButton} ${role.isActive ? styles.dangerButton : ''}`.trim()}
                      disabled={isSavingMapping}
                      onClick={() => void setRoleActiveState(role.id, !role.isActive)}
                    >
                      {role.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {roleCatalogOptions.length === 0 && (
                <tr>
                  <td colSpan={3}>No standardized roles available yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 className={styles.sectionTitle}>Bulk Reassign Mappings</h3>
        <div className={styles.referenceActionsCell}>
          <select
            className={styles.mappingSelect}
            aria-label="Reassign mappings from role"
            value={reassignFromRoleId}
            onChange={(event) => setReassignFromRoleId(event.target.value)}
          >
            <option value="">From role</option>
            {roleCatalogOptions.map((role) => (
              <option key={`from-${role.id}`} value={role.id}>{role.roleName}</option>
            ))}
          </select>
          <select
            className={styles.mappingSelect}
            aria-label="Reassign mappings to role"
            value={reassignToRoleId}
            onChange={(event) => setReassignToRoleId(event.target.value)}
          >
            <option value="">To role</option>
            {roleCatalogOptions.map((role) => (
              <option key={`to-${role.id}`} value={role.id}>{role.roleName}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.smallButton}
            disabled={!reassignFromRoleId || !reassignToRoleId || reassignFromRoleId === reassignToRoleId || isSavingMapping}
            onClick={() => void reassignMappings()}
          >
            Reassign
          </button>
        </div>
      </section>
    </div>
  );
}

export default MarketFrameworkTab;
