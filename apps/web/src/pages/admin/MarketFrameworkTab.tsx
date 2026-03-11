import { useEffect, useMemo, useState } from 'react';
import styles from '../AdminConsole.module.css';

const MATRIX_BANDS = [
  { key: 'T1', label: 'T1 — < 1 Year' },
  { key: 'T2', label: 'T2 — 1 Year' },
  { key: 'T3', label: 'T3 — 2–3 Years' },
  { key: 'T4', label: 'T4 — 4–5 Years' }
] as const;

type TenureBand = (typeof MATRIX_BANDS)[number]['key'];

type MatrixDraft = Record<TenureBand, { minSalary: string; maxSalary: string }>;

type MatrixRow = {
  id: string;
  roleName: string;
  tenureBand: TenureBand;
  minSalary: number | string;
  maxSalary: number | string;
};

type RoleAlignmentRow = {
  id?: string;
  rawRole: string;
  suggestedMatch: string | null;
  finalMatch: string | null;
  sourceOfMatch: 'AUTO' | 'ADMIN_CONFIRMED';
  confidence?: number;
};

const createEmptyDraft = (): MatrixDraft => ({
  T1: { minSalary: '', maxSalary: '' },
  T2: { minSalary: '', maxSalary: '' },
  T3: { minSalary: '', maxSalary: '' },
  T4: { minSalary: '', maxSalary: '' }
});

export function MarketFrameworkTab() {
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [matrixDraft, setMatrixDraft] = useState<MatrixDraft>(createEmptyDraft());
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);
  const [matrixSaveMsg, setMatrixSaveMsg] = useState<string | null>(null);
  const [overwritePending, setOverwritePending] = useState(false);

  const [standardRoles, setStandardRoles] = useState<string[]>([]);
  const [autoMapped, setAutoMapped] = useState<RoleAlignmentRow[]>([]);
  const [needsReview, setNeedsReview] = useState<RoleAlignmentRow[]>([]);
  const [confirmedMappings, setConfirmedMappings] = useState<RoleAlignmentRow[]>([]);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>({});

  const roleOptions = useMemo(
    () => Array.from(new Set(matrixRows.map((row) => row.roleName))).sort((a, b) => a.localeCompare(b)),
    [matrixRows]
  );

  const refreshMatrix = async () => {
    const response = await fetch('http://localhost:3001/market-matrix?viewerRole=ADMIN');
    const payload = await response.json();
    setMatrixRows(Array.isArray(payload?.data) ? payload.data : []);
  };

  const refreshRoleAlignment = async () => {
    const response = await fetch('http://localhost:3001/role-alignment/analysis?viewerRole=ADMIN');
    const payload = await response.json();
    const data = payload?.data || {};

    setStandardRoles(Array.isArray(data.standardRoles) ? data.standardRoles : []);
    setAutoMapped(Array.isArray(data.autoMapped) ? data.autoMapped : []);
    setNeedsReview(Array.isArray(data.needsReview) ? data.needsReview : []);
    setConfirmedMappings(Array.isArray(data.confirmedMappings) ? data.confirmedMappings : []);

    const nextOverrides: Record<string, string> = {};
    (Array.isArray(data.needsReview) ? data.needsReview : []).forEach((row: RoleAlignmentRow) => {
      if (row.rawRole) {
        nextOverrides[row.rawRole] = row.suggestedMatch || '';
      }
    });
    setRoleOverrides(nextOverrides);
  };

  useEffect(() => {
    void refreshMatrix();
    void refreshRoleAlignment();
  }, []);

  useEffect(() => {
    if (!selectedRole.trim()) {
      setMatrixDraft(createEmptyDraft());
      setOverwritePending(false);
      return;
    }

    const rowsForRole = matrixRows.filter((row) => row.roleName.toLowerCase() === selectedRole.trim().toLowerCase());
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
    if (!selectedRole.trim() || isSavingMatrix) {
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
          roleName: selectedRole.trim(),
          entries,
          overwrite
        })
      });

      const payload = await response.json();

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
      await refreshRoleAlignment();
    } catch {
      setMatrixSaveMsg('Failed to save matrix values');
    } finally {
      setIsSavingMatrix(false);
    }
  };

  const handleConfirmMapping = async (rawRole: string) => {
    const mappedRoleName = (roleOverrides[rawRole] || '').trim();
    if (!mappedRoleName) {
      return;
    }

    await fetch('http://localhost:3001/role-alignment/mappings?viewerRole=ADMIN', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceRoleName: rawRole,
        mappedRoleName
      })
    });

    await refreshRoleAlignment();
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
            <p className={styles.sectionSubtitle}>Maintain salary ranges by role and tenure band.</p>
          </div>
          <div className={styles.inlineActions}>
            <button
              type="button"
              onClick={() => void saveMatrix(false)}
              disabled={!selectedRole.trim() || isSavingMatrix}
              className={`${styles.syncButton} ${(!selectedRole.trim() || isSavingMatrix) ? styles.syncButtonDisabled : ''}`.trim()}
            >
              {isSavingMatrix ? 'Saving...' : 'Save Matrix'}
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
          </div>
        </div>

        <div className={styles.matrixRoleRow}>
          <label htmlFor="matrix-role" className={styles.matrixRoleLabel}>Role</label>
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
            {roleOptions.map((role) => (
              <option key={role} value={role} />
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
        <p className={styles.sectionSubtitle}>Read-only view of currently stored matrix values.</p>
        <div className={styles.referenceTableWrap}>
          <table className={styles.referenceTable}>
            <thead>
              <tr>
                <th>Role</th>
                <th>T1</th>
                <th>T2</th>
                <th>T3</th>
                <th>T4</th>
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
                          {row ? `${Number(row.minSalary).toLocaleString()} - ${Number(row.maxSalary).toLocaleString()}` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {Object.keys(groupedMatrixRows).length === 0 && (
                <tr>
                  <td colSpan={5}>No matrix values saved yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Role Alignment</h2>
        <p className={styles.sectionSubtitle}>Semi-automatic mapping of raw roles into standardized market roles.</p>

        <div className={styles.alignmentGrid}>
          <div className={styles.alignmentPanel}>
            <h4 className={styles.alignmentTitle}>Auto-Mapped Roles</h4>
            <table className={styles.alignmentTable}>
              <thead>
                <tr>
                  <th>Raw Role</th>
                  <th>Suggested Match</th>
                  <th>Final Match</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {autoMapped.map((row) => (
                  <tr key={row.rawRole}>
                    <td>{row.rawRole}</td>
                    <td>{row.suggestedMatch || '—'}</td>
                    <td>{row.finalMatch || '—'}</td>
                    <td>{row.sourceOfMatch}</td>
                  </tr>
                ))}
                {autoMapped.length === 0 && (
                  <tr>
                    <td colSpan={4}>No auto-mapped roles right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.alignmentPanel}>
            <h4 className={styles.alignmentTitle}>Needs Review</h4>
            <table className={styles.alignmentTable}>
              <thead>
                <tr>
                  <th>Raw Role</th>
                  <th>Suggested Match</th>
                  <th>Final Match</th>
                  <th>Source</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {needsReview.map((row) => (
                  <tr key={row.rawRole}>
                    <td>{row.rawRole}</td>
                    <td>{row.suggestedMatch || '—'}</td>
                    <td>
                      <select
                        className={styles.mappingSelect}
                        value={roleOverrides[row.rawRole] || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setRoleOverrides((prev) => ({ ...prev, [row.rawRole]: value }));
                        }}
                      >
                        <option value="">Select role</option>
                        {standardRoles.map((role) => (
                          <option key={`${row.rawRole}-${role}`} value={role}>{role}</option>
                        ))}
                      </select>
                    </td>
                    <td>AUTO</td>
                    <td>
                      <button className={styles.smallButton} onClick={() => void handleConfirmMapping(row.rawRole)}>
                        Confirm
                      </button>
                    </td>
                  </tr>
                ))}
                {needsReview.length === 0 && (
                  <tr>
                    <td colSpan={5}>No roles need review.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.alignmentPanel}>
            <h4 className={styles.alignmentTitle}>Confirmed Role Mappings</h4>
            <table className={styles.alignmentTable}>
              <thead>
                <tr>
                  <th>Raw Role</th>
                  <th>Suggested Match</th>
                  <th>Final Match</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {confirmedMappings.map((row) => (
                  <tr key={row.id || row.rawRole}>
                    <td>{row.rawRole}</td>
                    <td>{row.suggestedMatch || '—'}</td>
                    <td>{row.finalMatch || '—'}</td>
                    <td>{row.sourceOfMatch}</td>
                  </tr>
                ))}
                {confirmedMappings.length === 0 && (
                  <tr>
                    <td colSpan={4}>No confirmed mappings yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export default MarketFrameworkTab;
