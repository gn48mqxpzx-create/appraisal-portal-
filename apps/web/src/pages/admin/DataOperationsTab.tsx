import { useState, useEffect } from 'react';
import { ViewerSession } from '../../utils/auth';
import styles from '../AdminConsole.module.css';

interface DataOperationsTabProps {
  viewerSession: ViewerSession | null;
}

interface LiveSyncStatus {
  id: string;
  startedAt: string;
  completedAt: string | null;
  syncMode: string;
  triggeredBy: string;
  status: string;
  syncedCount: number;
  skippedCount: number;
  errorCount: number;
  conflictCount: number;
  durationMs: number | null;
}

interface SyncHistoryItem {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  syncMode: string;
  status?: string;
  syncedCount: number;
  updatedCount?: number | null;
  createdCount?: number | null;
  skippedCount: number;
  errorCount: number;
  conflictCount: number;
  summaryMessage?: string | null;
}

interface SessionSyncResult {
  lastResult: 'Success' | 'Failed';
  synced: number;
  updated: number;
  created: number;
  mergedDuplicates: number;
  skipped: number;
  conflicts: number;
  errors: string[];
  timestamp: string;
  mode: string;
}

export function DataOperationsTab({ viewerSession }: DataOperationsTabProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [liveSyncStatus, setLiveSyncStatus] = useState<LiveSyncStatus | null>(null);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [sessionSyncResult, setSessionSyncResult] = useState<SessionSyncResult | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingComp, setIsUploadingComp] = useState(false);
  const [compImportResult, setCompImportResult] = useState<{
    processed: number;
    updated: number;
    skipped: number;
    skippedStaffIds: string[];
    timestamp: string;
  } | null>(null);
  const [compImportError, setCompImportError] = useState<string | null>(null);

  const isAdmin = viewerSession?.role === 'Admin';

  // Fetch last sync record on mount
  useEffect(() => {
    if (!isAdmin) return;
    fetch('http://localhost:3001/admin/sync-status', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
    })
      .then((r) => r.json())
      .then((body) => { if (body?.data) setLiveSyncStatus(body.data); })
      .catch(() => {});

    fetch('http://localhost:3001/admin/sync-history?limit=25', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
    })
      .then((r) => r.json())
      .then((body) => { if (Array.isArray(body?.data)) setSyncHistory(body.data); })
      .catch(() => {});
  }, [isAdmin]);

  const handleRunDirectorySync = async () => {
    if (!isAdmin || isSyncing) return;
    setIsSyncing(true);

    try {
      const response = await fetch('http://localhost:3001/directory/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
      });
      const data = await response.json();

      if (!response.ok) {
        setSessionSyncResult({
          lastResult: 'Failed',
          synced: 0,
          updated: 0,
          created: 0,
          mergedDuplicates: 0,
          skipped: 0,
          conflicts: 0,
          errors: ['Directory sync failed. Check server logs.'],
          timestamp: new Date().toISOString(),
          mode: 'FULL'
        });
        return;
      }

      setSessionSyncResult({
        lastResult: 'Success',
        synced: Number(data?.synced ?? 0),
        updated: Number(data?.updated ?? 0),
        created: Number(data?.created ?? 0),
        mergedDuplicates: Number(data?.mergedDuplicates ?? 0),
        skipped: Number(data?.skipped ?? 0),
        conflicts: Number(data?.conflicts ?? 0),
        errors: Array.isArray(data?.errors) ? data.errors : [],
        timestamp: data?.timestamp || new Date().toISOString(),
        mode: data?.mode || 'FULL'
      });

      // Refresh live sync status
      fetch('http://localhost:3001/admin/sync-status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
      })
        .then((r) => r.json())
        .then((body) => { if (body?.data) setLiveSyncStatus(body.data); })
        .catch(() => {});

      fetch('http://localhost:3001/admin/sync-history?limit=25', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }
      })
        .then((r) => r.json())
        .then((body) => { if (Array.isArray(body?.data)) setSyncHistory(body.data); })
        .catch(() => {});
    } catch (_error) {
      setSessionSyncResult({
        lastResult: 'Failed',
        synced: 0,
        updated: 0,
        created: 0,
        mergedDuplicates: 0,
        skipped: 0,
        conflicts: 0,
        errors: ['Directory sync failed. Check server logs.'],
        timestamp: new Date().toISOString(),
        mode: 'FULL'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUploadCurrentCompensation = async () => {
    if (!isAdmin || isUploadingComp || !selectedFile) {
      return;
    }

    setIsUploadingComp(true);
    setCompImportError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('viewerRole', 'ADMIN');
      formData.append('viewerEmail', viewerSession?.viewer_email || '');
      formData.append('uploadedBy', viewerSession?.viewer_email || 'admin');

      const response = await fetch('http://localhost:3001/compensation/import', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        setCompImportResult(null);
        setCompImportError(data?.details || data?.error || 'Failed to import current compensation');
        return;
      }

      setCompImportResult({
        processed: Number(data?.processed ?? 0),
        updated: Number(data?.updated ?? 0),
        skipped: Number(data?.skipped ?? 0),
        skippedStaffIds: Array.isArray(data?.skippedStaffIds) ? data.skippedStaffIds : [],
        timestamp: data?.timestamp || new Date().toISOString()
      });
    } catch (error) {
      setCompImportResult(null);
      setCompImportError(error instanceof Error ? error.message : 'Unexpected upload error');
    } finally {
      setIsUploadingComp(false);
    }
  };

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Directory Sync</h2>
            <p className={styles.sectionSubtitle}>Run a live sync from HubSpot into Employee Directory.</p>
          </div>

          <button
            type="button"
            onClick={handleRunDirectorySync}
            disabled={isSyncing}
            className={`${styles.syncButton} ${isSyncing ? styles.syncButtonDisabled : ''}`.trim()}
          >
            {isSyncing ? 'Running Sync...' : 'Run Directory Sync'}
          </button>
        </div>

        <div className={styles.statusPanel}>
          {liveSyncStatus && !sessionSyncResult && (
            <div className={styles.statusGrid}>
              <p className={styles.statusText}><strong>Last sync:</strong> {liveSyncStatus.completedAt ? new Date(liveSyncStatus.completedAt).toLocaleString() : '—'}</p>
              <p className={styles.statusText}><strong>Mode:</strong> {liveSyncStatus.syncMode}</p>
              <p className={styles.statusText}><strong>Status:</strong> {liveSyncStatus.status}</p>
              <p className={styles.statusText}><strong>Synced:</strong> {liveSyncStatus.syncedCount} · <strong>Skipped:</strong> {liveSyncStatus.skippedCount} · <strong>Conflicts:</strong> {liveSyncStatus.conflictCount}</p>
              {liveSyncStatus.errorCount > 0 && <p className={styles.statusText}><strong>Errors:</strong> {liveSyncStatus.errorCount}</p>}
            </div>
          )}
          {sessionSyncResult ? (
            <div className={styles.statusGrid}>
              <p className={styles.statusText}><strong>Last result:</strong> {sessionSyncResult.lastResult}</p>
              <p className={styles.statusText}><strong>Mode:</strong> {sessionSyncResult.mode}</p>
              <p className={styles.statusText}><strong>Synced:</strong> {sessionSyncResult.synced}</p>
              <p className={styles.statusText}><strong>Updated:</strong> {sessionSyncResult.updated} · <strong>Created:</strong> {sessionSyncResult.created}</p>
              <p className={styles.statusText}><strong>Merged duplicates:</strong> {sessionSyncResult.mergedDuplicates} · <strong>Skipped:</strong> {sessionSyncResult.skipped} · <strong>Conflicts:</strong> {sessionSyncResult.conflicts}</p>
              <p className={styles.statusText}><strong>Timestamp:</strong> {new Date(sessionSyncResult.timestamp).toLocaleString()}</p>
              {sessionSyncResult.errors.length > 0 && <p className={styles.statusText}><strong>Errors:</strong> {sessionSyncResult.errors.join(' | ')}</p>}
            </div>
          ) : !liveSyncStatus ? (
            <p className={styles.emptyState}>No sync has been run yet.</p>
          ) : null}
        </div>

        <div className={styles.statusPanel}>
          <button
            type="button"
            className={styles.actionButtonSmall}
            onClick={() => setHistoryExpanded((value) => !value)}
          >
            {historyExpanded ? 'Hide Sync History' : 'Show Sync History'}
          </button>

          {historyExpanded && syncHistory.length > 0 ? (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Synced</th>
                    <th>Updated</th>
                    <th>Created</th>
                    <th>Skipped</th>
                    <th>Conflicts</th>
                  </tr>
                </thead>
                <tbody>
                  {syncHistory.map((row) => {
                    const updated = row.updatedCount ?? Math.max(0, Number(row.syncedCount || 0) - Number(row.errorCount || 0));
                    const created = row.createdCount ?? null;
                    return (
                      <tr key={row.id}>
                        <td>{new Date(row.completedAt || row.startedAt).toLocaleString()}</td>
                        <td>{row.syncMode}</td>
                        <td>{row.status || (row.errorCount > 0 ? 'FAILED' : 'SUCCESS')}</td>
                        <td>{Number(row.syncedCount || 0)}</td>
                        <td>{updated}</td>
                        <td>{created ?? '—'}</td>
                        <td>{Number(row.skippedCount || 0)}</td>
                        <td>{Number(row.conflictCount || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : historyExpanded ? (
            <p className={styles.emptyState} style={{ marginTop: 12 }}>No sync history available yet.</p>
          ) : null}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Current Compensation Import</h2>
            <p className={styles.sectionSubtitle}>Upload CSV with columns: Staff ID, Current Compensation, Currency, Effective Date.</p>
          </div>

          <button
            type="button"
            onClick={handleUploadCurrentCompensation}
            disabled={!selectedFile || isUploadingComp}
            className={`${styles.syncButton} ${(!selectedFile || isUploadingComp) ? styles.syncButtonDisabled : ''}`.trim()}
          >
            {isUploadingComp ? 'Uploading...' : 'Upload CSV'}
          </button>
        </div>

        <div className={styles.uploadRow}>
          <label htmlFor="current-comp-csv" className={styles.fileLabel}>Select CSV file</label>
          <input
            id="current-comp-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            className={styles.fileInput}
          />
        </div>

        <p className={styles.helperText}>Expected columns: Staff ID, Current Compensation, Currency, Effective Date.</p>

        <div className={styles.statusPanel}>
          {compImportError && (
            <p className={styles.errorText}>{compImportError}</p>
          )}

          {compImportResult ? (
            <div className={styles.statusGrid}>
              <p className={styles.statusText}><strong>Processed:</strong> {compImportResult.processed}</p>
              <p className={styles.statusText}><strong>Updated:</strong> {compImportResult.updated}</p>
              <p className={styles.statusText}><strong>Skipped:</strong> {compImportResult.skipped}</p>
              <p className={styles.statusText}><strong>Skipped staff IDs:</strong> {compImportResult.skippedStaffIds.length ? compImportResult.skippedStaffIds.join(', ') : 'None'}</p>
              <p className={styles.statusText}><strong>Timestamp:</strong> {new Date(compImportResult.timestamp).toLocaleString()}</p>
            </div>
          ) : !compImportError ? (
            <p className={styles.emptyState}>No current compensation import has been run yet in this session.</p>
          ) : null}
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>WSLL Import</h2>
        <p className={styles.sectionSubtitle}>Placeholder for next data operation module.</p>
      </section>
    </div>
  );
}

export default DataOperationsTab;
