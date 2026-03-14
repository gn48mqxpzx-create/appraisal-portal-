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

const CATEGORIES = ['', 'IDENTITY', 'HIERARCHY', 'ROLE', 'COMPENSATION', 'WSLL', 'APPRAISAL'];
const SEVERITIES = ['', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = ['OPEN', 'NEEDS_ADMIN_REVIEW', '', 'AUTO_RESOLVED', 'RESOLVED'];

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('OPEN');
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [loading, setLoading] = useState(false);

  const authHeader = { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` };
  const isAdmin = viewerSession?.role === 'Admin';
  const LIMIT = 50;

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
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (filterCategory) params.set('category', filterCategory);
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterStatus) params.set('status', filterStatus);

    fetch(`http://localhost:3001/admin/data-quality?${params}`, { headers: authHeader })
      .then((r) => r.json())
      .then((body) => {
        setIssues(Array.isArray(body?.issues) ? body.issues : []);
        setTotal(Number(body?.total ?? 0));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin, page, filterCategory, filterSeverity, filterStatus]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchIssues(); }, [fetchIssues]);

  const handleRunChecks = async () => {
    if (!isAdmin || isRunningChecks) return;
    setIsRunningChecks(true);
    try {
      await fetch('http://localhost:3001/admin/data-quality/run', { method: 'POST', headers: authHeader });
      fetchSummary();
      fetchIssues();
    } catch { /* non-fatal */ }
    finally { setIsRunningChecks(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

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

      {/* Issue table */}
      <section className={styles.card}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <select
            aria-label="Filter by category"
            title="Filter by category"
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All Categories'}</option>)}
          </select>
          <select
            aria-label="Filter by severity"
            title="Filter by severity"
            value={filterSeverity}
            onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            {SEVERITIES.map((s) => <option key={s} value={s}>{s || 'All Severities'}</option>)}
          </select>
          <select
            aria-label="Filter by status"
            title="Filter by status"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className={styles.filterSelect}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
          </select>
        </div>

        {loading ? (
          <p className={styles.emptyState}>Loading…</p>
        ) : issues.length === 0 ? (
          <p className={styles.emptyState}>No issues found for the selected filters.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Issue Type</th>
                    <th>Employee</th>
                    <th>Staff ID</th>
                    <th>Detected Problem</th>
                    <th>Suggested Fix</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <span className={`${styles.classificationChip} ${styles[SEVERITY_STYLES[issue.severity] ?? 'chipNeutral']}`}>
                          {formatLabel(issue.issueType)}
                        </span>
                      </td>
                      <td>{issue.employeeName || '—'}</td>
                      <td>{issue.staffId || '—'}</td>
                      <td style={{ maxWidth: 320 }}>{issue.description}</td>
                      <td style={{ maxWidth: 320 }}>{getSuggestedFix(issue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <button
                  type="button"
                  className={styles.actionButtonSmall}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  ← Prev
                </button>
                <span className={styles.statusText}>Page {page} / {totalPages} ({total} total)</span>
                <button
                  type="button"
                  className={styles.actionButtonSmall}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default DataQualityTab;
