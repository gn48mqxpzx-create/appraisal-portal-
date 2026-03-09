import { useState } from 'react';
import { ViewerSession } from '../utils/auth';
import styles from './AdminConsole.module.css';

interface AdminConsoleProps {
  viewerSession: ViewerSession | null;
}

interface DirectorySyncStatus {
  lastResult: 'Success' | 'Failed';
  synced: number;
  skipped: number;
  errors: string[];
  timestamp: string;
}

export function AdminConsole({ viewerSession }: AdminConsoleProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<DirectorySyncStatus | null>(null);

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

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Admin Console</h1>
        <p className={styles.subtitle}>Manage system configuration and data synchronization</p>

        {isAdmin && (
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
                  <p className={styles.statusText}>
                    <strong>Last result:</strong> {syncStatus.lastResult}
                  </p>
                  <p className={styles.statusText}>
                    <strong>Synced count:</strong> {syncStatus.synced}
                  </p>
                  <p className={styles.statusText}>
                    <strong>Skipped count:</strong> {syncStatus.skipped}
                  </p>
                  <p className={styles.statusText}>
                    <strong>Timestamp:</strong> {new Date(syncStatus.timestamp).toLocaleString()}
                  </p>
                  <p className={styles.statusText}>
                    <strong>Errors:</strong> {syncStatus.errors.length ? syncStatus.errors.join(' | ') : 'None'}
                  </p>
                </div>
              ) : (
                <p className={styles.emptyState}>No sync has been run yet in this session.</p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default AdminConsole;
