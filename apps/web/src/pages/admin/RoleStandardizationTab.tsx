import { useEffect, useState, useMemo } from 'react';
import styles from '../AdminConsole.module.css';

type MatchStatus = 'Learned' | 'Auto-Matched' | 'Needs Review' | 'New Role Suggested' | 'Approved';

type RoleLibraryRow = {
  id?: string;
  rawRole: string;
  suggestedStandardRole: string | null;
  finalStandardRole: string | null;
  matchStatus: MatchStatus;
  matchSource: 'SAVED_RULE' | 'AUTO_SIMILARITY' | 'NEW_ROLE_SUGGESTION' | 'ADMIN_CONFIRMED';
  confidenceScore?: number | null;
  standardizedRoleSuggestion?: string;
  standardizedRoleId?: string;
};

type RoleCatalogItem = {
  id: string;
  roleName: string;
  isActive: boolean;
};

const normalize = (value: string) => value.trim().toLowerCase();

const STATUS_COLORS: Record<MatchStatus, string> = {
  'Learned': '#10b981',
  'Auto-Matched': '#60a5fa',
  'Needs Review': '#f59e0b',
  'New Role Suggested': '#f97316',
  'Approved': '#8b5cf6'
};

const STATUS_ORDER: Record<MatchStatus, number> = {
  'Needs Review': 0,
  'New Role Suggested': 1,
  'Auto-Matched': 2,
  'Learned': 3,
  'Approved': 4
};

export function RoleStandardizationTab() {
  const [allRoles, setAllRoles] = useState<RoleLibraryRow[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [isRematching, setIsRematching] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<MatchStatus | 'all'>('all');
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState('');
  const [editingRoleInput, setEditingRoleInput] = useState('');
  const [comboOpen, setComboOpen] = useState(false);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, string>>({});

  useEffect(() => {
    void refreshData();
  }, []);

  const refreshData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:3001/role-library/analysis?viewerRole=ADMIN');
      const payload = await response.json();
      const data = payload?.data || {};

      setRoleCatalog(Array.isArray(data.roleCatalog) ? data.roleCatalog : []);

      // Combine all roles into one unified list
      const approvedLibrary = Array.isArray(data.approvedLibrary) ? data.approvedLibrary : [];
      const autoResolved = Array.isArray(data.autoResolved) ? data.autoResolved : [];
      const reviewQueue = Array.isArray(data.reviewQueue) ? data.reviewQueue : [];

      const unified = [
        ...approvedLibrary,
        ...autoResolved,
        ...reviewQueue
      ].sort((a, b) => {
        // Sort by status priority first, then by raw role name
        const aOrder = STATUS_ORDER[a.matchStatus as MatchStatus] ?? 999;
        const bOrder = STATUS_ORDER[b.matchStatus as MatchStatus] ?? 999;
        const statusDiff = aOrder - bOrder;
        if (statusDiff !== 0) return statusDiff;
        return a.rawRole.localeCompare(b.rawRole);
      });

      setAllRoles(unified);

      // Initialize review decisions
      const nextDecisions: Record<string, string> = {};
      reviewQueue.forEach((row: RoleLibraryRow) => {
        nextDecisions[row.rawRole] = row.suggestedStandardRole || row.standardizedRoleSuggestion || '';
      });
      setReviewDecisions(nextDecisions);
    } catch (e: any) {
      setError(e.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const filteredRoles = useMemo(() => {
    if (selectedStatus === 'all') {
      return allRoles;
    }
    return allRoles.filter(role => role.matchStatus === selectedStatus);
  }, [allRoles, selectedStatus]);

  const statusCounts = useMemo(() => {
    const counts: Record<MatchStatus, number> = {
      'Learned': 0,
      'Auto-Matched': 0,
      'Needs Review': 0,
      'New Role Suggested': 0,
      'Approved': 0
    };
    allRoles.forEach(role => {
      counts[role.matchStatus]++;
    });
    return counts;
  }, [allRoles]);

  const approveRole = async (row: RoleLibraryRow) => {
    const chosenRoleName = (reviewDecisions[row.rawRole] || row.suggestedStandardRole || row.standardizedRoleSuggestion || '').trim();
    if (!chosenRoleName) {
      setError('Please select or enter a standardized role');
      return;
    }

    const matchedRole = roleCatalog.find((role) => normalize(role.roleName) === normalize(chosenRoleName));

    setIsSavingMapping(true);
    setError(null);
    setSuccessMsg(null);

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
        setError(payload?.error || 'Failed to approve role');
        return;
      }

      setSuccessMsg(`✓ Approved mapping for "${row.rawRole}"`);
      await refreshData();
      setEditingRowKey(null);
      setEditingRoleId('');
    } catch (e: any) {
      setError(e.message || 'Failed to approve role');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const roleCatalogOptions = useMemo(
    () => roleCatalog.filter(role => role.isActive).sort((a, b) => a.roleName.localeCompare(b.roleName)),
    [roleCatalog]
  );

  const comboFilteredOptions = useMemo(() => {
    const q = editingRoleInput.trim().toLowerCase();
    if (!q) return roleCatalogOptions;
    return roleCatalogOptions.filter(r => r.roleName.toLowerCase().includes(q));
  }, [roleCatalogOptions, editingRoleInput]);

  const showCreateOption = useMemo(() => {
    const q = editingRoleInput.trim();
    if (!q) return false;
    return !roleCatalogOptions.some(r => normalize(r.roleName) === normalize(q));
  }, [roleCatalogOptions, editingRoleInput]);

  const getRowKey = (row: RoleLibraryRow) => `${row.id || 'raw'}-${row.rawRole}`;

  const handleStartEdit = (row: RoleLibraryRow) => {
    const rowKey = getRowKey(row);
    const fallbackName = row.finalStandardRole || row.suggestedStandardRole || row.standardizedRoleSuggestion || '';
    const matchedById = row.standardizedRoleId
      ? roleCatalogOptions.find((role) => role.id === row.standardizedRoleId)
      : undefined;
    const matchedByName = fallbackName
      ? roleCatalogOptions.find((role) => normalize(role.roleName) === normalize(fallbackName))
      : undefined;
    const matched = matchedById || matchedByName;

    setEditingRowKey(rowKey);
    setEditingRoleId(matched?.id || '');
    setEditingRoleInput(matched?.roleName || fallbackName);
    setComboOpen(false);
  };

  const saveEdit = async (row: RoleLibraryRow) => {
    const inputTrimmed = editingRoleInput.trim();
    // Resolve: typed text may match catalog even if user didn't click an item
    const matchedByName = inputTrimmed
      ? roleCatalogOptions.find(r => normalize(r.roleName) === normalize(inputTrimmed))
      : undefined;
    const resolvedId = editingRoleId || matchedByName?.id || '';
    const isNewRole = !resolvedId && !!inputTrimmed;

    if (!resolvedId && !inputTrimmed) {
      setError('Please select or enter a standardized role');
      return;
    }

    setIsSavingMapping(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (row.id) {
        const body = isNewRole
          ? { newRoleName: inputTrimmed }
          : { standardizedRoleId: resolvedId };

        const response = await fetch(`http://localhost:3001/role-library/mappings/${row.id}?viewerRole=ADMIN`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload?.error || 'Failed to update mapping');
          return;
        }
      } else {
        const response = await fetch('http://localhost:3001/role-library/approve?viewerRole=ADMIN', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceRoleName: row.rawRole,
            standardizedRoleId: isNewRole ? undefined : resolvedId,
            standardizedRoleName: inputTrimmed,
            allowCreateRole: isNewRole,
            confidenceScore: row.confidenceScore ?? null
          })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload?.error || 'Failed to update mapping');
          return;
        }
      }

      setSuccessMsg(`✓ Updated mapping for "${row.rawRole}"`);
      await refreshData();
      setEditingRowKey(null);
      setEditingRoleId('');
      setEditingRoleInput('');
    } catch (e: any) {
      setError(e.message || 'Failed to update mapping');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const rematchRole = async (row: RoleLibraryRow) => {
    if (!row.id) {
      setError('This row does not have a persisted mapping to re-match');
      return;
    }

    setIsRematching(row.id);
    setError(null);
    setSuccessMsg(null);

    try {
      const response = await fetch(`http://localhost:3001/role-library/rematch/${row.id}?viewerRole=ADMIN`, {
        method: 'POST'
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload?.error || 'Failed to re-run matching');
        return;
      }

      const payload = await response.json();
      const data = payload?.data || {};
      setSuccessMsg(`✓ Re-matched "${row.rawRole}" → ${data.suggestedRole || 'No suggestion'}`);
      await refreshData();
    } catch (e: any) {
      setError(e.message || 'Failed to re-run matching');
    } finally {
      setIsRematching(null);
    }
  };

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.sectionTitle}>Role Standardization</h3>
            <p className={styles.sectionSubtitle}>Unified role-cleaning interface. Review, approve, or override raw role suggestions.</p>
          </div>
        </div>

        {error && (
          <div className={styles.errorBox} style={{ marginBottom: '1rem' }}>
            <p>{error}</p>
          </div>
        )}

        {successMsg && (
          <div className={styles.successBox} style={{ marginBottom: '1rem' }}>
            <p>{successMsg}</p>
          </div>
        )}

        {/* Status Filter Bar */}
        <div className={styles.filterBar} style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSelectedStatus('all')}
            className={`${styles.filterButton} ${selectedStatus === 'all' ? styles.filterButtonActive : ''}`}
          >
            All ({allRoles.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatus('Needs Review')}
            className={`${styles.filterButton} ${selectedStatus === 'Needs Review' ? styles.filterButtonActive : ''}`}
          >
            Needs Review ({statusCounts['Needs Review']})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatus('New Role Suggested')}
            className={`${styles.filterButton} ${selectedStatus === 'New Role Suggested' ? styles.filterButtonActive : ''}`}
          >
            New Role Suggested ({statusCounts['New Role Suggested']})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatus('Auto-Matched')}
            className={`${styles.filterButton} ${selectedStatus === 'Auto-Matched' ? styles.filterButtonActive : ''}`}
          >
            Auto-Matched ({statusCounts['Auto-Matched']})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatus('Learned')}
            className={`${styles.filterButton} ${selectedStatus === 'Learned' ? styles.filterButtonActive : ''}`}
          >
            Learned ({statusCounts['Learned']})
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatus('Approved')}
            className={`${styles.filterButton} ${selectedStatus === 'Approved' ? styles.filterButtonActive : ''}`}
          >
            Approved ({statusCounts['Approved']})
          </button>
        </div>

        {loading && <p className={styles.infoText}>Loading roles...</p>}

        {!loading && filteredRoles.length === 0 && (
          <p className={styles.infoText}>No roles found for this filter.</p>
        )}

        {!loading && filteredRoles.length > 0 && (
          <div className={styles.referenceTableWrap}>
            <table className={styles.referenceTable}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.75rem' }}>Raw Role</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem' }}>Suggested Standard Role</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem' }}>Final Standard Role</th>
                  <th style={{ textAlign: 'center', padding: '0.75rem', width: '140px' }}>Status</th>
                  <th style={{ textAlign: 'center', padding: '0.75rem', width: '240px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map((row) => {
                  const statusColor = STATUS_COLORS[row.matchStatus];
                  const rowKey = getRowKey(row);
                  const isEditing = editingRowKey === rowKey;
                  const value = reviewDecisions[row.rawRole] || row.finalStandardRole || row.suggestedStandardRole || row.standardizedRoleSuggestion || '';
                  const canEdit = ['Auto-Matched', 'Learned', 'Needs Review', 'New Role Suggested', 'Approved'].includes(row.matchStatus);
                  const canRematch = row.id && (row.matchStatus === 'Auto-Matched' || row.matchStatus === 'Learned');
                  const canApprove = row.matchStatus === 'Needs Review' || row.matchStatus === 'New Role Suggested';
                  const selectedEditRole = roleCatalogOptions.find((role) => role.id === editingRoleId);

                  return (
                    <tr key={`${row.rawRole}-${row.id || row.matchStatus}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem', fontWeight: '500' }}>
                        {row.rawRole}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#666' }}>
                        {row.suggestedStandardRole || row.standardizedRoleSuggestion || '—'}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                        {isEditing ? (
                          <div style={{ position: 'relative', maxWidth: '220px' }}>
                            <input
                              type="text"
                              className={styles.mappingSelect}
                              value={editingRoleInput}
                              placeholder="Search or create role..."
                              autoFocus
                              autoComplete="off"
                              onChange={(e) => {
                                setEditingRoleInput(e.target.value);
                                setEditingRoleId('');
                                setComboOpen(true);
                              }}
                              onFocus={() => setComboOpen(true)}
                              onBlur={() => setTimeout(() => setComboOpen(false), 150)}
                            />
                            {comboOpen && (
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                backgroundColor: '#fff',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                zIndex: 50,
                                maxHeight: '200px',
                                overflowY: 'auto'
                              }}>
                                {comboFilteredOptions.map(role => (
                                  <div
                                    key={role.id}
                                    onMouseDown={() => {
                                      setEditingRoleId(role.id);
                                      setEditingRoleInput(role.roleName);
                                      setComboOpen(false);
                                    }}
                                    style={{
                                      padding: '6px 10px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      backgroundColor: role.id === editingRoleId ? '#f0f9ff' : 'transparent'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = role.id === editingRoleId ? '#f0f9ff' : 'transparent'; }}
                                  >
                                    {role.roleName}
                                  </div>
                                ))}
                                {showCreateOption && (
                                  <div
                                    onMouseDown={() => {
                                      setEditingRoleId('');
                                      setComboOpen(false);
                                    }}
                                    style={{
                                      padding: '6px 10px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      color: '#7c3aed',
                                      fontWeight: '600',
                                      borderTop: comboFilteredOptions.length > 0 ? '1px solid #e5e7eb' : 'none'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f3ff'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    Create new role: "{editingRoleInput.trim()}"
                                  </div>
                                )}
                                {comboFilteredOptions.length === 0 && !showCreateOption && (
                                  <div style={{ padding: '6px 10px', fontSize: '12px', color: '#9ca3af' }}>
                                    No roles found
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontWeight: '500' }}>{value || '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            backgroundColor: statusColor,
                            color: 'white',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }}
                        >
                          {row.matchStatus}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className={styles.smallButton}
                              disabled={isSavingMapping || (!editingRoleId && !editingRoleInput.trim())}
                              onClick={() => saveEdit(row)}
                              style={{ marginRight: '0.5rem' }}
                            >
                              {isSavingMapping ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className={`${styles.smallButton} ${styles.dangerButton}`}
                              onClick={() => {
                                setEditingRowKey(null);
                                setEditingRoleId('');
                                setEditingRoleInput('');
                              }}
                              disabled={isSavingMapping}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {canApprove && (
                              <button
                                type="button"
                                className={styles.smallButton}
                                disabled={isSavingMapping}
                                onClick={() => approveRole({
                                  ...row,
                                  suggestedStandardRole: value,
                                  standardizedRoleId: row.standardizedRoleId || selectedEditRole?.id
                                } as RoleLibraryRow)}
                                style={{ marginRight: '0.5rem' }}
                              >
                                {isSavingMapping ? 'Saving...' : 'Approve'}
                              </button>
                            )}

                            {canEdit && (
                              <button
                                type="button"
                                className={styles.smallButton}
                                onClick={() => handleStartEdit(row)}
                                style={{ marginRight: canRematch ? '0.5rem' : 0 }}
                              >
                                Edit
                              </button>
                            )}

                            {canRematch && (
                                <button
                                  type="button"
                                  className={styles.smallButton}
                                  disabled={isRematching === row.id}
                                  onClick={() => rematchRole(row)}
                                >
                                  {isRematching === row.id ? 'Re-matching...' : 'Re-match'}
                                </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
