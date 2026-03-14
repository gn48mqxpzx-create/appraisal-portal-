import { useState } from 'react';
import { ViewerSession } from '../utils/auth';
import styles from './AdminConsole.module.css';
import DataOperationsTab from './admin/DataOperationsTab';
import { MarketFramework } from './admin/MarketFramework';
import SystemControlsTab from './admin/SystemControlsTab';
import DataQualityTab from './admin/DataQualityTab';

interface AdminConsoleProps {
  viewerSession: ViewerSession | null;
}

export function AdminConsole({ viewerSession }: AdminConsoleProps) {
  const [activeTab, setActiveTab] = useState<'data' | 'market' | 'system' | 'quality'>('data');

  const isAdmin = viewerSession?.role === 'Admin';

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Admin Console</h1>
        <p className={styles.subtitle}>Manage system configuration and data synchronization</p>

        {isAdmin && (
          <>
            <div className={styles.tabRow}>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'data' ? styles.tabButtonActive : ''}`.trim()}
                onClick={() => setActiveTab('data')}
              >
                Data Operations
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'market' ? styles.tabButtonActive : ''}`.trim()}
                onClick={() => setActiveTab('market')}
              >
                Market Framework
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'system' ? styles.tabButtonActive : ''}`.trim()}
                onClick={() => setActiveTab('system')}
              >
                System Controls
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'quality' ? styles.tabButtonActive : ''}`.trim()}
                onClick={() => setActiveTab('quality')}
              >
                Data Quality
              </button>
            </div>

            {activeTab === 'data' && <DataOperationsTab viewerSession={viewerSession} />}
            {activeTab === 'market' && <MarketFramework />}
            {activeTab === 'system' && <SystemControlsTab />}
            {activeTab === 'quality' && <DataQualityTab viewerSession={viewerSession} />}
          </>
        )}
      </div>
    </div>
  );
}

export default AdminConsole;
