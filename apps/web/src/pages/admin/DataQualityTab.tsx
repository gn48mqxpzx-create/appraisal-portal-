import { useState, useEffect, useCallback, useRef } from 'react';
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
  metadata?: {
    caseStatus?: string;
    hubspotRole?: string;
    caseRole?: string;
    staffRole?: string;
    normalizedRole?: string;
    workingDataRole?: string;
    rootCause?: string;
    suggestedFix?: string;
    caseName?: string;
    directoryName?: string;
    status?: string;
    [key: string]: unknown;
  } | null;
}

interface DQSummary {
  openIssues: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  byCategory: Record<string, number>;
}

interface CheckRunHistory {
  id: string;
  startedAt: string;
  completedAt: string | null;
  runBy: string | null;
  totalIssues: number;
  highSeverityCount: number;
  medSeverityCount: number;
  lowSeverityCount: number;
  reliabilityScore: number | null;
  summaryMessage: string | null;
}

interface ActionLog {
  id: string;
  actionType: string;
  startedAt: string;
  completedAt: string | null;
  runBy: string | null;
  affectedRecords: number;
  recordsRepaired?: number | null;
  casesRefreshed?: number | null;
  failuresCount?: number | null;
  status: string;
  summaryMessage: string | null;
}

interface RoleSuggestion {
  sourceRoleName: string;
  normalizedRoleName: string;
  similarity: number;
}

interface CorrectionFields {
  staffId?: string;
  fullName?: string;
  hubspotRole?: string;
  normalizedRole?: string;
  successManagerName?: string;
  reportingManagerName?: string;
  startDate?: string;
  currentCompensation?: string;
  isEmploymentActive?: boolean;
}

type ActionType = 'edit-record' | 'correct-role' | 'fix-staff-id' | 'correct-manager' | 'rebuild-employee' | 'close-case';

interface ModalState {
  open: boolean;
  issue: DQIssue | null;
  actionType: ActionType;
  corrections: CorrectionFields;
  submitting: boolean;
  error: string | null;
  suggestions: RoleSuggestion[];
  loadingSuggestions: boolean;
}

const API = 'http://localhost:3001';

function getAuthHeader() {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`, 'Content-Type': 'application/json' };
}

function getMeta(issue: DQIssue, ...keys: string[]): string | null {
  if (!issue.metadata) return null;
  for (const key of keys) {
    const val = issue.metadata[key];
    if (typeof val === 'string' && val.trim()) return val;
  }
  return null;
}

function getHubspotRole(issue: DQIssue) {
  return getMeta(issue, 'hubspotRole', 'staffRole', 'caseRole') ?? '\u2014';
}

function getCaseStatus(issue: DQIssue) {
  return getMeta(issue, 'caseStatus', 'status') ?? '\u2014';
}

function getExpectedRole(issue: DQIssue) {
  return getMeta(issue, 'normalizedRole', 'workingDataRole') ?? '\u2014';
}

function getRootCause(issue: DQIssue): string {
  const fromMeta = getMeta(issue, 'rootCause');
  if (fromMeta) return fromMeta;
  const fallbacks: Record<string, string> = {
    OPEN_CASE_MISSING_EMPLOYEE_DIRECTORY: 'Staff ID has an open case but no directory record',
    STAFF_ID_NOT_FOUND: 'Staff ID in open case not found in employee directory',
    OPEN_CASE_MISSING_WORKING_DATA: 'Employee has an open case but no working data record',
    OPEN_CASE_INACTIVE_EMPLOYEE: 'Employee is marked inactive but has an open appraisal case',
    EMPLOYEE_NAME_MISMATCH: 'Name in appraisal case differs from employee directory',
    ROLE_TEXT_MISMATCH: 'HubSpot role on case differs from working data role',
    MISSING_COMPENSATION_DATA: 'No compensation record found for this employee',
    MISSING_SUCCESS_MANAGER: 'No Success Manager assigned in working data or directory',
    MISSING_REPORTING_MANAGER: 'No Reporting Manager assigned in working data or directory',
    APPROVED_ROLE_NOT_PROPAGATED: 'Approved role was not written through to working data',
    APPROVED_ROLE_MISSING_NORMALIZED_ROLE: 'Approved role has no normalized role mapping',
    MISSING_COMPANY_NAME: 'Company name is missing in HubSpot contact data',
    UNRESOLVED_INTERNAL_COMPANY: 'Company could not be normalized to internal identity',
    OPEN_CASE_REQUIRES_RM_OVERRIDE: 'Open case requires RM override before recommendation',
    INACTIVE_EMPLOYEE_ACTIVE_CASE: 'Employee is inactive but still has an active case',
    DUPLICATE_EMAIL: 'Duplicate email address found in directory',
    DUPLICATE_HUBSPOT_ID: 'Duplicate HubSpot ID found across employees',
    MISSING_SM: 'Success Manager is not assigned',
    MISSING_RM: 'Reporting Manager is not assigned',
  };
  return fallbacks[issue.issueType] ?? issue.description ?? '\u2014';
}

function getActionType(issue: DQIssue): ActionType {
  switch (issue.issueType) {
    case 'OPEN_CASE_MISSING_EMPLOYEE_DIRECTORY':
    case 'STAFF_ID_NOT_FOUND':
      return 'fix-staff-id';
    case 'OPEN_CASE_MISSING_WORKING_DATA':
      return 'rebuild-employee';
    case 'OPEN_CASE_INACTIVE_EMPLOYEE':
    case 'INACTIVE_EMPLOYEE_ACTIVE_CASE':
      return 'close-case';
    case 'EMPLOYEE_NAME_MISMATCH':
    case 'DUPLICATE_EMAIL':
    case 'DUPLICATE_HUBSPOT_ID':
      return 'edit-record';
    case 'ROLE_TEXT_MISMATCH':
    case 'APPROVED_ROLE_NOT_PROPAGATED':
    case 'APPROVED_ROLE_MISSING_NORMALIZED_ROLE':
      return 'correct-role';
    case 'MISSING_SM':
    case 'MISSING_RM':
    case 'MISSING_SUCCESS_MANAGER':
    case 'MISSING_REPORTING_MANAGER':
      return 'correct-manager';
    case 'OPEN_CASE_REQUIRES_RM_OVERRIDE':
      return 'edit-record';
    default:
      return 'edit-record';
  }
}

function getActionLabel(actionType: ActionType): string {
  switch (actionType) {
    case 'edit-record': return 'Edit Record';
    case 'correct-role': return 'Fix Role';
    case 'fix-staff-id': return 'Fix Staff ID';
    case 'correct-manager': return 'Fix Manager';
    case 'rebuild-employee': return 'Rebuild Data';
    case 'close-case': return 'Close Cases';
  }
}

function getReliabilityLabel(score: number): { label: string; className: string } {
  if (score >= 95) return { label: 'Excellent', className: styles.reliabilityExcellent };
  if (score >= 85) return { label: 'Good', className: styles.reliabilityGood };
  if (score >= 70) return { label: 'Needs Attention', className: styles.reliabilityAttention };
  return { label: 'Critical', className: styles.reliabilityCritical };
}

function formatLabel(v: string) {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string | null) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}

const SEVERITY_CHIP: Record<string, string> = {
  HIGH: 'chipAmber',
  MEDIUM: 'chipBlue',
  LOW: 'chipNeutral',
};

const MODAL_DEFAULTS: ModalState = {
  open: false,
  issue: null,
  actionType: 'edit-record',
  corrections: {},
  submitting: false,
  error: null,
  suggestions: [],
  loadingSuggestions: false,
};

export function DataQualityTab({ viewerSession }: DataQualityTabProps) {
  const [summary, setSummary] = useState<DQSummary | null>(null);
  const [issues, setIssues] = useState<DQIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [latestScore, setLatestScore] = useState<number | null>(null);
  const [checkHistory, setCheckHistory] = useState<CheckRunHistory[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionLog[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [modal, setModal] = useState<ModalState>(MODAL_DEFAULTS);
  const suggestionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdmin = viewerSession?.role === 'Admin';

  const fetchAll = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const headers = getAuthHeader();
      const [summaryRes, issuesRes, checkHistRes, actionHistRes] = await Promise.all([
        fetch(`${API}/admin/data-quality/summary`, { headers }),
        fetch(`${API}/admin/data-quality?page=1&limit=300&status=OPEN`, { headers }),
        fetch(`${API}/admin/data-quality/check-history?limit=20`, { headers }),
        fetch(`${API}/admin/data-quality/action-history?limit=20`, { headers }),
      ]);
      const [summaryBody, issuesBody, checkHistBody, actionHistBody] = await Promise.all([
        summaryRes.json().catch(() => ({})),
        issuesRes.json().catch(() => ({})),
        checkHistRes.json().catch(() => ({})),
        actionHistRes.json().catch(() => ({})),
      ]);
      if (summaryBody?.data) setSummary(summaryBody.data);
      setIssues(Array.isArray(issuesBody?.issues) ? issuesBody.issues : []);
      const runs: CheckRunHistory[] = Array.isArray(checkHistBody?.data) ? checkHistBody.data : [];
      setCheckHistory(runs);
      if (runs.length > 0 && runs[0].reliabilityScore != null) {
        setLatestScore(runs[0].reliabilityScore);
      }
      setActionHistory(Array.isArray(actionHistBody?.data) ? actionHistBody.data : []);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleRunChecks = async () => {
    if (!isAdmin || isRunning) return;
    setIsRunning(true);
    setRunMessage(null);
    try {
      const res = await fetch(`${API}/admin/data-quality/run`, { method: 'POST', headers: getAuthHeader() });
      const body = await res.json().catch(() => ({}));
      const { detected = 0, reliabilityScore } = body?.data ?? {};
      if (reliabilityScore != null) setLatestScore(reliabilityScore);
      setRunMessage({
        text: detected > 0
          ? `${detected} issue(s) detected. Reliability score: ${reliabilityScore ?? '\u2014'}%.`
          : `No issues detected. Reliability score: ${reliabilityScore ?? '\u2014'}%.`,
        isError: false,
      });
      await fetchAll();
    } catch {
      setRunMessage({ text: 'Failed to run checks.', isError: true });
    } finally {
      setIsRunning(false);
    }
  };

  const openModal = (issue: DQIssue) => {
    const actionType = getActionType(issue);
    setModal({
      ...MODAL_DEFAULTS,
      open: true,
      issue,
      actionType,
      corrections: { staffId: issue.staffId ?? undefined },
    });
    if (actionType === 'correct-role') {
      const raw = getHubspotRole(issue);
      if (raw && raw !== '\u2014') loadSuggestions(raw);
    }
  };

  const closeModal = () => setModal(MODAL_DEFAULTS);

  const loadSuggestions = (rawRole: string) => {
    if (suggestionTimeout.current) clearTimeout(suggestionTimeout.current);
    setModal((m) => ({ ...m, loadingSuggestions: true, suggestions: [] }));
    suggestionTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/admin/data-quality/suggestions?rawRole=${encodeURIComponent(rawRole)}`, { headers: getAuthHeader() });
        const body = await res.json().catch(() => ({}));
        setModal((m) => ({ ...m, suggestions: Array.isArray(body?.data) ? body.data : [], loadingSuggestions: false }));
      } catch {
        setModal((m) => ({ ...m, loadingSuggestions: false }));
      }
    }, 300);
  };

  const handleCorrectionField = (field: keyof CorrectionFields, value: string | boolean) => {
    setModal((m) => ({ ...m, corrections: { ...m.corrections, [field]: value } }));
    if (field === 'hubspotRole' && typeof value === 'string' && value.trim()) {
      loadSuggestions(value);
    }
  };

  const handleSubmitModal = async () => {
    if (!modal.issue || modal.submitting) return;
    setModal((m) => ({ ...m, submitting: true, error: null }));
    const { staffId } = modal.issue;
    const runBy = viewerSession?.viewer_email ?? 'admin';
    try {
      let res: Response;
      if (modal.actionType === 'rebuild-employee') {
        res = await fetch(`${API}/admin/data-quality/rebuild-employee/${encodeURIComponent(staffId ?? '')}`, {
          method: 'POST', headers: getAuthHeader(),
        });
      } else if (modal.actionType === 'close-case') {
        res = await fetch(`${API}/admin/data-quality/close-case/${encodeURIComponent(staffId ?? '')}`, {
          method: 'POST', headers: getAuthHeader(),
        });
      } else {
        res = await fetch(`${API}/admin/data-quality/correct`, {
          method: 'POST',
          headers: getAuthHeader(),
          body: JSON.stringify({ staffId, issueId: modal.issue.id, corrections: modal.corrections, runBy }),
        });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModal((m) => ({ ...m, submitting: false, error: body?.error?.message ?? 'Request failed.' }));
        return;
      }
      closeModal();
      await fetchAll();
    } catch {
      setModal((m) => ({ ...m, submitting: false, error: 'Network error. Please try again.' }));
    }
  };

  if (!isAdmin) return null;

  const open = issues.filter((i) => i.status === 'OPEN');
  const missingEmployee = open.filter((i) => ['OPEN_CASE_MISSING_EMPLOYEE_DIRECTORY', 'STAFF_ID_NOT_FOUND'].includes(i.issueType)).length;
  const inactiveOpen = open.filter((i) => ['OPEN_CASE_INACTIVE_EMPLOYEE', 'INACTIVE_EMPLOYEE_ACTIVE_CASE'].includes(i.issueType)).length;
  const roleFailures = open.filter((i) => i.category === 'ROLE').length;
  const propagationFailures = open.filter((i) => ['APPROVED_ROLE_NOT_PROPAGATED', 'APPROVED_ROLE_MISSING_NORMALIZED_ROLE'].includes(i.issueType)).length;
  const reliabilityInfo = latestScore != null ? getReliabilityLabel(latestScore) : null;

  return (
    <div className={styles.stack}>
      {/* Header */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Data Integrity Console</h2>
            <p className={styles.sectionSubtitle}>Detect, diagnose, and correct data anomalies across the appraisal pipeline.</p>
          </div>
          <button
            type="button"
            onClick={handleRunChecks}
            disabled={isRunning}
            className={`${styles.syncButton} ${isRunning ? styles.syncButtonDisabled : ''}`.trim()}
          >
            {isRunning ? 'Running\u2026' : 'Run Checks'}
          </button>
        </div>
        {runMessage && (
          <p className={runMessage.isError ? styles.errorText : styles.infoText}>{runMessage.text}</p>
        )}
      </section>

      {/* Reliability score + summary metrics */}
      <div className={styles.summaryMetricsRow}>
        {latestScore != null && reliabilityInfo && (
          <div className={styles.reliabilityCard}>
            <div className={styles.reliabilityScoreRow}>
              <span className={styles.reliabilityScoreNum}>{latestScore}%</span>
              <span className={`${styles.reliabilityBadge} ${reliabilityInfo.className}`}>{reliabilityInfo.label}</span>
            </div>
            <p className={styles.reliabilityLabel}>Data Reliability Score</p>
            {summary && (
              <div className={styles.scoreBreakdown}>
                <span className={`${styles.classificationChip} ${styles.chipAmber}`}>High: {summary.highSeverity}</span>
                {' '}
                <span className={`${styles.classificationChip} ${styles.chipBlue}`}>Med: {summary.mediumSeverity}</span>
                {' '}
                <span className={`${styles.classificationChip} ${styles.chipNeutral}`}>Low: {summary.lowSeverity}</span>
              </div>
            )}
          </div>
        )}
        <div className={styles.summaryMetricCard}>
          <span className={styles.summaryMetricNumber}>{summary?.openIssues ?? 0}</span>
          <span className={styles.summaryMetricLabel}>Total Open Issues</span>
        </div>
        <div className={styles.summaryMetricCard}>
          <span className={styles.summaryMetricNumber}>{missingEmployee}</span>
          <span className={styles.summaryMetricLabel}>Missing Employee Records</span>
        </div>
        <div className={styles.summaryMetricCard}>
          <span className={styles.summaryMetricNumber}>{inactiveOpen}</span>
          <span className={styles.summaryMetricLabel}>Inactive with Open Cases</span>
        </div>
        <div className={styles.summaryMetricCard}>
          <span className={styles.summaryMetricNumber}>{roleFailures}</span>
          <span className={styles.summaryMetricLabel}>Role Mapping Failures</span>
        </div>
        <div className={styles.summaryMetricCard}>
          <span className={styles.summaryMetricNumber}>{propagationFailures}</span>
          <span className={styles.summaryMetricLabel}>Propagation Failures</span>
        </div>
      </div>

      {/* Issues table */}
      <section className={styles.card}>
        <h3 className={styles.sectionTitle} style={{ marginBottom: 12 }}>Open Issues</h3>
        {loading ? (
          <p className={styles.emptyState}>Loading\u2026</p>
        ) : open.length === 0 ? (
          <p className={styles.emptyState}>No open data quality issues detected.</p>
        ) : (
          <div className={styles.issueTableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Staff ID</th>
                  <th>Employee Name</th>
                  <th>Case Status</th>
                  <th>HubSpot Role</th>
                  <th>Expected Role</th>
                  <th>Issue Type</th>
                  <th>Root Cause</th>
                  <th>Suggested Fix</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {open.map((issue) => {
                  const actionType = getActionType(issue);
                  return (
                    <tr key={issue.id}>
                      <td>{issue.staffId || '\u2014'}</td>
                      <td>{issue.employeeName || getMeta(issue, 'caseName', 'directoryName') || '\u2014'}</td>
                      <td>{getCaseStatus(issue)}</td>
                      <td>{getHubspotRole(issue)}</td>
                      <td>{getExpectedRole(issue)}</td>
                      <td>
                        <span className={`${styles.classificationChip} ${styles[SEVERITY_CHIP[issue.severity] ?? 'chipNeutral']}`}>
                          {formatLabel(issue.issueType)}
                        </span>
                      </td>
                      <td style={{ maxWidth: 220 }}>{getRootCause(issue)}</td>
                      <td style={{ maxWidth: 220 }}>{getMeta(issue, 'suggestedFix') ?? 'Review source records and re-run checks.'}</td>
                      <td>
                        <div className={styles.actionBtnGroup}>
                          <button
                            type="button"
                            className={styles.actionButtonSmall}
                            onClick={() => openModal(issue)}
                          >
                            {getActionLabel(actionType)}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* History */}
      <section className={styles.card}>
        <button
          type="button"
          className={styles.historyToggle}
          onClick={() => setHistoryExpanded((v) => !v)}
        >
          {historyExpanded ? '\u25b2' : '\u25bc'} History &amp; Audit Log ({checkHistory.length} check runs, {actionHistory.length} actions)
        </button>

        {historyExpanded && (
          <div className={styles.historyContent}>
            <h4 className={styles.historySubtitle}>Check Run History</h4>
            {checkHistory.length === 0 ? (
              <p className={styles.historyTableEmpty}>No check runs recorded.</p>
            ) : (
              <table className={`${styles.dataTable} ${styles.historyTable}`}>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Run By</th>
                    <th>Issues</th>
                    <th>High</th>
                    <th>Med</th>
                    <th>Low</th>
                    <th>Score</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {checkHistory.map((run) => {
                    const score = run.reliabilityScore;
                    const info = score != null ? getReliabilityLabel(score) : null;
                    return (
                      <tr key={run.id}>
                        <td>{formatDate(run.startedAt)}</td>
                        <td>{run.runBy ?? '\u2014'}</td>
                        <td>{run.totalIssues}</td>
                        <td>{run.highSeverityCount}</td>
                        <td>{run.medSeverityCount}</td>
                        <td>{run.lowSeverityCount}</td>
                        <td>
                          {score != null && info ? (
                            <span className={`${styles.classificationChip} ${info.className}`}>{score}% {info.label}</span>
                          ) : '\u2014'}
                        </td>
                        <td>{run.summaryMessage ?? '\u2014'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <h4 className={styles.historySubtitle} style={{ marginTop: 20 }}>Action &amp; Rebuild Log</h4>
            {actionHistory.length === 0 ? (
              <p className={styles.historyTableEmpty}>No system actions recorded.</p>
            ) : (
              <table className={`${styles.dataTable} ${styles.historyTable}`}>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Action</th>
                    <th>Run By</th>
                    <th>Records Affected</th>
                    <th>Repaired</th>
                    <th>Cases</th>
                    <th>Failures</th>
                    <th>Status</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {actionHistory.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDate(log.startedAt)}</td>
                      <td>{formatLabel(log.actionType)}</td>
                      <td>{log.runBy ?? '\u2014'}</td>
                      <td>{log.affectedRecords}</td>
                      <td>{log.recordsRepaired ?? '\u2014'}</td>
                      <td>{log.casesRefreshed ?? '\u2014'}</td>
                      <td>{log.failuresCount ?? '\u2014'}</td>
                      <td>
                        <span className={`${styles.classificationChip} ${log.status === 'SUCCESS' ? styles.chipGreen : styles.chipAmber}`}>
                          {log.status}
                        </span>
                      </td>
                      <td>{log.summaryMessage ?? '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Correction Modal */}
      {modal.open && modal.issue && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>{getActionLabel(modal.actionType)}: {modal.issue.employeeName ?? modal.issue.staffId ?? 'Employee'}</span>
              <button type="button" className={styles.modalClose} onClick={closeModal}>\u00d7</button>
            </div>

            <div className={styles.modalBody}>
              {modal.error && <p className={styles.errorText}>{modal.error}</p>}

              {modal.actionType === 'edit-record' && (
                <>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-full-name">Full Name</label>
                    <input
                      id="dq-full-name"
                      className={styles.formInput}
                      type="text"
                      title="Full Name"
                      aria-label="Full Name"
                      defaultValue={modal.issue.employeeName ?? ''}
                      onChange={(e) => handleCorrectionField('fullName', e.target.value)}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-start-date">Start Date</label>
                    <input
                      id="dq-start-date"
                      className={styles.formInput}
                      type="date"
                      title="Start Date"
                      aria-label="Start Date"
                      onChange={(e) => handleCorrectionField('startDate', e.target.value)}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-employment-active">
                      <input
                        id="dq-employment-active"
                        type="checkbox"
                        className={styles.formCheck}
                        title="Employment Active"
                        aria-label="Employment Active"
                        defaultChecked
                        onChange={(e) => handleCorrectionField('isEmploymentActive', e.target.checked)}
                      />
                      {' '}Employment Active
                    </label>
                  </div>
                </>
              )}

              {modal.actionType === 'correct-role' && (
                <>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-hubspot-role">HubSpot Role (raw)</label>
                    <input
                      id="dq-hubspot-role"
                      className={styles.formInput}
                      type="text"
                      title="HubSpot Role"
                      aria-label="HubSpot Role"
                      defaultValue={getHubspotRole(modal.issue)}
                      onChange={(e) => handleCorrectionField('hubspotRole', e.target.value)}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-normalized-role">Normalized Role Override</label>
                    <input
                      id="dq-normalized-role"
                      className={styles.formInput}
                      type="text"
                      title="Normalized Role Override"
                      aria-label="Normalized Role Override"
                      placeholder="Leave blank to auto-map"
                      onChange={(e) => handleCorrectionField('normalizedRole', e.target.value)}
                    />
                  </div>
                  {modal.loadingSuggestions && <p className={styles.infoText}>Loading suggestions\u2026</p>}
                  {modal.suggestions.length > 0 && (
                    <div className={styles.suggestionList}>
                      <p className={styles.formLabel}>Smart suggestions:</p>
                      {modal.suggestions.map((s) => (
                        <button
                          key={s.sourceRoleName}
                          type="button"
                          className={styles.suggestionItem}
                          onClick={() => {
                            handleCorrectionField('hubspotRole', s.sourceRoleName);
                            handleCorrectionField('normalizedRole', s.normalizedRoleName);
                          }}
                        >
                          <span>{s.sourceRoleName}</span>
                          <span className={styles.suggestionArrow}>\u2192</span>
                          <span>{s.normalizedRoleName}</span>
                          <span className={styles.suggestionScore}>{Math.round(s.similarity * 100)}%</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {modal.actionType === 'fix-staff-id' && (
                <div className={styles.formRow}>
                  <label className={styles.formLabel} htmlFor="dq-correct-staff-id">Correct Staff ID</label>
                  <input
                    id="dq-correct-staff-id"
                    className={styles.formInput}
                    type="text"
                    title="Correct Staff ID"
                    aria-label="Correct Staff ID"
                    defaultValue={modal.issue.staffId ?? ''}
                    onChange={(e) => handleCorrectionField('staffId', e.target.value)}
                  />
                </div>
              )}

              {modal.actionType === 'correct-manager' && (
                <>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-success-manager">Success Manager Name</label>
                    <input
                      id="dq-success-manager"
                      className={styles.formInput}
                      type="text"
                      title="Success Manager Name"
                      aria-label="Success Manager Name"
                      onChange={(e) => handleCorrectionField('successManagerName', e.target.value)}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor="dq-reporting-manager">Reporting Manager Name</label>
                    <input
                      id="dq-reporting-manager"
                      className={styles.formInput}
                      type="text"
                      title="Reporting Manager Name"
                      aria-label="Reporting Manager Name"
                      onChange={(e) => handleCorrectionField('reportingManagerName', e.target.value)}
                    />
                  </div>
                </>
              )}

              {modal.actionType === 'rebuild-employee' && (
                <p className={styles.infoText}>
                  This will rebuild the working data record for <strong>{modal.issue.employeeName ?? modal.issue.staffId}</strong> and re-run data quality checks.
                </p>
              )}

              {modal.actionType === 'close-case' && (
                <p className={styles.infoText}>
                  All open cases for <strong>{modal.issue.employeeName ?? modal.issue.staffId}</strong> will be set to <strong>Removed From Scope</strong>.
                  This cannot be undone without manual intervention.
                </p>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnGhost} onClick={closeModal} disabled={modal.submitting}>
                Cancel
              </button>
              <button
                type="button"
                className={modal.actionType === 'close-case' ? styles.btnDanger : styles.btnPrimary}
                onClick={handleSubmitModal}
                disabled={modal.submitting}
              >
                {modal.submitting ? 'Saving\u2026' : modal.actionType === 'close-case' ? 'Close Cases' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataQualityTab;
