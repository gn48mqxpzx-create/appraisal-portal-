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

const createEmptyDraft = (): MatrixDraft => ({
  T1: { minSalary: '', maxSalary: '' },
  T2: { minSalary: '', maxSalary: '' },
  T3: { minSalary: '', maxSalary: '' },
  T4: { minSalary: '', maxSalary: '' }
});

const normalize = (value: string) => value.trim().toLowerCase();

export function MarketMatrixTab() {
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [matrixDraft, setMatrixDraft] = useState<MatrixDraft>(createEmptyDraft());
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);
  const [matrixSaveMsg, setMatrixSaveMsg] = useState<string | null>(null);
  const [overwritePending, setOverwritePending] = useState(false);
  const [isDeletingRole, setIsDeletingRole] = useState(false);

  const [rolesWithoutMatrices, setRolesWithoutMatrices] = useState<RoleCatalogItem[]>([]);
  const [allRoleCatalog, setAllRoleCatalog] = useState<RoleCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedCatalogRole = useMemo(
    () => allRoleCatalog.find((role) => normalize(role.roleName) === normalize(selectedRole)) ?? null,
    [allRoleCatalog, selectedRole]
  );

  const rolesWithoutMatricesOptions = useMemo(
    () => rolesWithoutMatrices.slice().sort((a, b) => a.roleName.localeCompare(b.roleName)),
    [rolesWithoutMatrices]
  );

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

  const refreshMatrix = async () => {
    const response = await fetch('http://localhost:3001/market-matrix?viewerRole=ADMIN');
    const payload = await response.json();
    setMatrixRows(Array.isArray(payload?.data) ? payload.data : []);
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      // Fetch all matrix rows
      await refreshMatrix();

      // Fetch all active roles for catalog
      const catalogRes = await fetch('http://localhost:3001/role-library/roles?viewerRole=ADMIN');
      const catalogPayload = await catalogRes.json();
      const catalog = Array.isArray(catalogPayload?.data) ? catalogPayload.data : [];
      setAllRoleCatalog(catalog);

      // Fetch roles without matrices
      const noMatrixRes = await fetch('http://localhost:3001/market-matrix/roles-without-matrices?viewerRole=ADMIN');
      const noMatrixPayload = await noMatrixRes.json();
      const rolesNoMatrix = Array.isArray(noMatrixPayload?.data) ? noMatrixPayload.data : [];
      setRolesWithoutMatrices(rolesNoMatrix);
    } catch (error) {
      console.error('Error refreshing matrix data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
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
      await refreshData();
      setSelectedRole('');
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
      await refreshData();
    } catch {
      setMatrixSaveMsg('Failed to delete role matrix');
    } finally {
      setIsDeletingRole(false);
    }
  };

  return (
    <div className={styles.stack}>
      {/* Add Matrix Section */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.sectionTitle}>Add Market Matrix</h3>
            <p className={styles.sectionSubtitle}>Select a standardized role and enter T1–T4 salary ranges.</p>
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
          <label htmlFor="matrix-role-no-matrix" className={styles.matrixRoleLabel}>
            Standardized Role (without matrix)
          </label>
          <select
            id="matrix-role-no-matrix"
            value={selectedRole}
            onChange={(event) => {
              setSelectedRole(event.target.value);
              setMatrixSaveMsg(null);
            }}
            className={styles.matrixRoleInput}
          >
            <option value="">— Select a role to add matrix —</option>
            {rolesWithoutMatricesOptions.map((role) => (
              <option key={role.id} value={role.roleName}>
                {role.roleName}
              </option>
            ))}
          </select>
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

      {/* Saved Matrix Reference */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle}>Saved Market Matrix Reference</h3>
        <p className={styles.sectionSubtitle}>All existing market benchmark data. Click "Edit Role" to modify values.</p>
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
                  <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: '#999' }}>
                    No matrix values saved yet. Start by selecting a role above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
