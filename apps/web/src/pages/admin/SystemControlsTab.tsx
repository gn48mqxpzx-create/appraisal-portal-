import { useState } from 'react';
import styles from '../AdminConsole.module.css';
import { IncreaseGuardrailsTab } from './IncreaseGuardrailsTab';

type SystemSection = 'guardrails';

export function SystemControlsTab() {
  const [section, setSection] = useState<SystemSection>('guardrails');

  const navBtn = (key: SystemSection, label: string) => (
    <button
      type="button"
      onClick={() => setSection(key)}
      style={{
        padding: '6px 16px',
        borderRadius: 6,
        border: section === key ? '1px solid #111827' : '1px solid #e5e7eb',
        background: section === key ? '#111827' : '#fff',
        color: section === key ? '#fff' : '#374151',
        fontSize: 13,
        fontWeight: section === key ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <section className={styles.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {navBtn('guardrails', 'Increase Guardrails')}
      </div>

      {section === 'guardrails' && <IncreaseGuardrailsTab />}
    </section>
  );
}

export default SystemControlsTab;

