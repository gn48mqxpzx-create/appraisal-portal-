import { useState } from 'react';
import { ViewerSession } from '../../utils/auth';
import styles from '../AdminConsole.module.css';

interface DataOperationsTabProps {
  viewerSession: ViewerSession | null;
}

interface DirectorySyncStatus {
  lastResult: 'Success' | 'Failed';
  synced: number;
  skipped: number;
  errors: string[];
  timestamp: string;
}

export function DataOperationsTab({ viewerSession }: DataOperationsTabProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<DirectorySyncStatus | null>(null);

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

  const handleRunDirectorySync = async () => {
    if (!isAdmin || isSyncing) {
      return;
    }

    setIsSyncing(true);

    try {
      const response = await fetch('http://localhost:3001/directory/sync', {
        method: 'POST'
      });
      const data = await response.json();

      if (!response.ok) {
        const detail = data?.details || data?.error || 'Sync request failed';
        setSyncStatus({
          lastResult: 'Failed',
          synced: 0,
          skipped: 0,
          errors: [detail],
          timestamp: new Date().toISOString()
        });
        return;
      }

      setSyncStatus({
        lastResult: 'Success',
        synced: Number(data?.synced ?? 0),
        skipped: Number(data?.skipped ?? 0),
        errors: Array.isArray(data?.errors) ? data.errors : [],
        timestamp: data?.timestamp || new Date().toISOString()
      });
    } catch (error) {
      setSyncStatus({
        lastResult: 'Failed',
        synced: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unexpected error'],
        timestamp: new Date().toISOString()
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
          {syncStatus ? (
            <div className={styles.statusGrid}>
              <p className={styles.statusText}><strong>Last result:</strong> {syncStatus.lastResult}</p>
              <p className={styles.statusText}><strong>Synced count:</strong> {syncStatus.synced}</p>
              <p className={styles.statusText}><strong>Skipped count:</strong> {syncStatus.skipped}</p>
              <p className={styles.statusText}><strong>Timestamp:</strong> {new Date(syncStatus.timestamp).toLocaleString()}</p>
              <p className={styles.statusText}><strong>Errors:</strong> {syncStatus.errors.length ? syncStatus.errors.join(' | ') : 'None'}</p>
            </div>
          ) : (
            <p className={styles.emptyState}>No sync has been run yet in this session.</p>
          )}
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
