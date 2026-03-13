import { useState } from 'react';
import styles from '../AdminConsole.module.css';
import { RoleStandardizationTab } from './RoleStandardizationTab';
import { MarketMatrixTab } from './MarketMatrixTab';

export function MarketFramework() {
  const [activeTab, setActiveTab] = useState<'standardization' | 'matrix'>('standardization');

  return (
    <div className={styles.stack}>
      {/* Page Header */}
      <section className={styles.card}>
        <div>
          <h2 className={styles.sectionTitle}>Market Framework</h2>
          <p className={styles.sectionSubtitle}>Standardize roles and manage market benchmarks.</p>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className={styles.tabNav}>
        <button
          type="button"
          onClick={() => setActiveTab('standardization')}
          className={`${styles.tabButton} ${activeTab === 'standardization' ? styles.tabButtonActive : ''}`}
        >
          Role Standardization
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('matrix')}
          className={`${styles.tabButton} ${activeTab === 'matrix' ? styles.tabButtonActive : ''}`}
        >
          Market Matrix
        </button>
      </div>

      {/* Tab Content */}
      <div className={styles.tabContent}>
        {activeTab === 'standardization' && <RoleStandardizationTab />}
        {activeTab === 'matrix' && <MarketMatrixTab />}
      </div>
    </div>
  );
}
