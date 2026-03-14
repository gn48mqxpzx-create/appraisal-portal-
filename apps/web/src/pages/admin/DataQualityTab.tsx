import { useState, useEffect, useCallback } from 'react';
import { ViewerSession } from '../../utils/auth';
import styles from '../AdminConsole.module.css';

interface DataQualityTabProps {
  viewerSession: ViewerSession | null;
}

interface DQIssue {
  id: string;
  staffId: string | null;
  employeeName: string | null;
  issueType: string;
  category: string;
  severity: string;
  description: string;
  status: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  metadata?: Record<string, unknown> | null;
}

interface DQSummary {
  openIssues: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  byCategory: Record<string, number>;
}

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: 'chipAmber',
  MEDIUM: 'chipBlue',
  LOW: 'chipNeutral'
};

function formatLabel(v: string) {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSuggestedFix(issue: DQIssue): string {
  const suggested = issue.metadata && typeof issue.metadata === 'object'
    ? (issue.metadata as Record<string, unknown>).suggestedFix
    : null;

  if (typeof suggested === 'string' && suggested.trim()) {
    return suggested;
  }

  return 'Review source records and re-run Data Quality checks.';
}

export function DataQualityTab({ viewerSession }: DataQualityTabProps) {
  const [summary, setSummary] = useState<DQSummary | null>(null);
  const [issues, setIssues] = useState<DQIssue[]>([]);
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const authHeader = { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` };
  const isAdmin = viewerSession?.role === 'Admin';
  const LIMIT = 200;

  const fetchSummary = useCallback(() => {
    if (!isAdmin) return;
    fetch('http://localhost:3001/admin/data-quality/summary', { headers: authHeader })
      .then((r) => r.json())
      .then((body) => { if (body?.data) setSummary(body.data); })
      .catch(() => {});
  }, [isAdmin]);

  const fetchIssues = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    const params = new URLSearchParams({ page: '1', limit: String(LIMIT), status: 'OPEN' });

    fetch(`http://localhost:3001/admin/data-quality?${params}`, { headers: authHeader })
      .then((r) => r.json())
      .then((body) => {
        setIssues(Array.isArray(body?.issues) ? body.issues : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  const handleRunChecks = async () => {
    if (!isAdmin || isRunningChecks) return;
    setIsRunningChecks(true);
    setRunMessage(null);
    try {
      const response = await fetch('http://localhost:3001/admin/data-quality/run', { method: 'POST', headers: authHeader });
      const payload = await response.json().catch(() => ({}));
      const detected = Number(payload?.data?.detected ?? 0);
      setRunMessage(detected > 0 ? `${detected} issue(s) detected or updated.` : 'No data quality issues detected.');
      fetchSummary();
      fetchIssues();
    } catch { /* non-fatal */ }
    finally { setIsRunningChecks(false); }
  };

  if (!isAdmin) return null;

  return (
    <div className={styles.stack}>
      {/* Summary bar */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Data Quality</h2>
            <p className={styles.sectionSubtitle}>Anomalies detected from the employee evaluation pipeline.</p>
          </div>
          <button
            type="button"
            onClick={handleRunChecks}
            disabled={isRunningChecks}
            className={`${styles.syncButton} ${isRunningChecks ? styles.syncButtonDisabled : ''}`.trim()}
          >
            {isRunningChecks ? 'Running…' : 'Run Checks'}
          </button>
        </div>

        {summary && (
          <div className={styles.statusGrid}>
            <p className={styles.statusText}><strong>Open issues:</strong> {summary.openIssues}</p>
            <p className={styles.statusText}>
              <span className={`${styles.classificationChip} ${styles.chipAmber}`}>High: {summary.highSeverity}</span>
              {' '}
              <span className={`${styles.classificationChip} ${styles.chipBlue}`}>Medium: {summary.mediumSeverity}</span>
              {' '}
              <span className={`${styles.classificationChip} ${styles.chipNeutral}`}>Low: {summary.lowSeverity}</span>
            </p>
            {Object.keys(summary.byCategory).length > 0 && (
              <p className={styles.statusText}>
                {Object.entries(summary.byCategory).map(([cat, n]) => (
                  <span key={cat} className={`${styles.classificationChip} ${styles.chipNeutral}`} style={{ marginRight: 4 }}>
                    {cat}: {n}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </section>

      {runMessage ? <p className={styles.infoText}>{runMessage}</p> : null}

      {/* Issue table */}
      <section className={styles.card}>
        {loading ? (
          <p className={styles.emptyState}>Loading…</p>
        ) : issues.length === 0 ? (
          <p className={styles.emptyState}>No data quality issues detected.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Staff ID</th>
                  <th>Issue</th>
                  <th>Suggested Fix</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td>{issue.employeeName || '—'}</td>
                    <td>{issue.staffId || '—'}</td>
                    <td style={{ maxWidth: 360 }}>
                      <span className={`${styles.classificationChip} ${styles[SEVERITY_STYLES[issue.severity] ?? 'chipNeutral']}`}>
                        {formatLabel(issue.issueType)}
                      </span>
                      <div style={{ marginTop: 6 }}>{issue.description}</div>
                    </td>
                    <td style={{ maxWidth: 320 }}>{getSuggestedFix(issue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default DataQualityTab;
