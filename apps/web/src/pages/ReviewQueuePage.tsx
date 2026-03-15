import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, getPhpToAudRate } from '../utils/currencyDisplay';
import { getWorkflowStageFromStatus, getWorkflowStageLabel } from '../utils/workflowStage';
import styles from './ReviewQueuePage.module.css';

type ReviewDecision = 'APPROVE_AS_SUBMITTED' | 'OVERRIDE_AND_APPROVE' | 'REJECT';
type OverrideInputMode = 'TARGET_SALARY' | 'INCREASE_AMOUNT' | 'INCREASE_PERCENT';
type GuardrailLevel = 'Green' | 'Yellow' | 'Red' | 'Unknown';

interface ReviewQueuePageProps {
  viewerSession: ViewerSession | null;
}

interface ReviewQueueItem {
  caseId: string;
  staffId: string;
  employeeName: string;
  client: string;
  role: string;
  currentSalary: number | null;
  proposedTargetSalary: number | null;
  increasePercent: number | null;
  guardrailLevel: string | null;
  submittedBy: string | null;
  submittedDate: string | null;
  reasonForReview?: string;
  actionType?: 'RM_OVERRIDE_REQUEST' | 'RECOMMENDATION_REVIEW';
  rmOverrideStatus?: 'NOT_REQUIRED' | 'REQUESTED' | 'APPROVED';
}

interface ReviewHistoryItem {
  id: string;
  caseId: string;
  employeeName: string;
  company: string | null;
  actionType: string;
  actionBy: string;
  actionRole: string | null;
  actionTimestamp: string;
  previousStatus: string;
  newStatus: string;
  comment: string | null;
}

interface WorkflowRecommendation {
  recommendationType: string | null;
  targetSalary: number | null;
  increaseAmount: number | null;
  increasePercent: number | null;
  guardrailLevel: string | null;
  guardrailAction?: string | null;
  customInputMode?: string | null;
  justification?: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  reviewDecision?: string | null;
  reviewerNotes?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

interface WorkflowData {
  caseId: string;
  staffId: string;
  fullName: string;
  companyName?: string | null;
  status: string;
  rmOverrideStatus?: 'NOT_REQUIRED' | 'REQUESTED' | 'APPROVED';
  currentSalary: number | null;
  submittedRecommendation: WorkflowRecommendation | null;
  finalRecommendation: WorkflowRecommendation | null;
}

interface GuardrailResult {
  guardrailLevel: GuardrailLevel;
  colorCode: string;
  actionRequired: string;
}

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const getGuardrailMessage = (guardrailLevel: GuardrailLevel | null | undefined): string => {
  if (guardrailLevel === 'Green') {
    return 'Within recommended range';
  }

  if (guardrailLevel === 'Yellow') {
    return 'Manager justification required before submission';
  }

  if (guardrailLevel === 'Red') {
    return 'Executive approval required before submission';
  }

  return 'Additional review required before submission';
};

const REVIEW_QUEUE_LOAD_ERROR_MESSAGE = 'Unable to load review items right now. Please refresh or try again.';
const REVIEW_HISTORY_LOAD_ERROR_MESSAGE = 'Unable to load review history right now. Please refresh or try again.';

const formatHistoryWorkflowStatus = (status: string | null | undefined) => {
  if (!status) {
    return '—';
  }

  return getWorkflowStageLabel(getWorkflowStageFromStatus(status));
};

const buildOverridePreview = (currentSalary: number | null, inputMode: OverrideInputMode, inputValue: string) => {
  const parsed = Number(inputValue);
  if (currentSalary === null || !Number.isFinite(currentSalary) || !Number.isFinite(parsed)) {
    return null;
  }

  let targetSalary = currentSalary;
  let increaseAmount = 0;
  let increasePercent = 0;

  if (inputMode === 'TARGET_SALARY') {
    targetSalary = parsed;
    increaseAmount = targetSalary - currentSalary;
    increasePercent = currentSalary === 0 ? 0 : (increaseAmount / currentSalary) * 100;
  } else if (inputMode === 'INCREASE_AMOUNT') {
    increaseAmount = parsed;
    targetSalary = currentSalary + increaseAmount;
    increasePercent = currentSalary === 0 ? 0 : (increaseAmount / currentSalary) * 100;
  } else {
    increasePercent = parsed;
    increaseAmount = currentSalary * (increasePercent / 100);
    targetSalary = currentSalary + increaseAmount;
  }

  return {
    targetSalary,
    increaseAmount,
    increasePercent
  };
};

export function ReviewQueuePage({ viewerSession }: ReviewQueuePageProps) {
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>('APPROVE_AS_SUBMITTED');
  const [overrideInputMode, setOverrideInputMode] = useState<OverrideInputMode>('TARGET_SALARY');
  const [overrideInputValue, setOverrideInputValue] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [guardrailResult, setGuardrailResult] = useState<GuardrailResult | null>(null);
  const [guardrailLoading, setGuardrailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [history, setHistory] = useState<ReviewHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyActionTypeFilter, setHistoryActionTypeFilter] = useState('ALL');
  const [historyReviewerFilter, setHistoryReviewerFilter] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const phpToAudRate = useMemo(() => getPhpToAudRate(), []);

  const viewerRole = useMemo(() => {
    if (!viewerSession) {
      return '';
    }

    return viewerSession.role === 'Admin' ? 'ADMIN' : viewerSession.role;
  }, [viewerSession]);

  const loadQueue = async () => {
    if (!viewerSession || !viewerRole) {
      setQueue([]);
      return;
    }

    setLoadingQueue(true);
    setQueueError(null);

    try {
      const params = new URLSearchParams({ viewerRole });
      if (viewerRole !== 'ADMIN') {
        params.set('viewerName', viewerSession.viewer_name);
        params.set('viewerEmail', viewerSession.viewer_email);
      }

      const response = await fetch(`http://localhost:3001/review-queue?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setQueue([]);
        setQueueError(payload?.error?.message || REVIEW_QUEUE_LOAD_ERROR_MESSAGE);
        return;
      }

      const items = Array.isArray(payload?.data) ? payload.data as ReviewQueueItem[] : [];
      setQueue(items);

      if (selectedItem) {
        const refreshed = items.find((item) => item.caseId === selectedItem.caseId) || null;
        setSelectedItem(refreshed);
      }
    } catch {
      setQueue([]);
      setQueueError(REVIEW_QUEUE_LOAD_ERROR_MESSAGE);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, [viewerRole, viewerSession]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!viewerSession || !viewerRole || activeTab !== 'history') {
        return;
      }

      setLoadingHistory(true);
      setHistoryError(null);

      try {
        const params = new URLSearchParams({
          viewerRole,
          page: String(historyPage),
          pageSize: String(historyPageSize)
        });

        if (viewerRole !== 'ADMIN') {
          params.set('viewerName', viewerSession.viewer_name);
          params.set('viewerEmail', viewerSession.viewer_email);
        }

        if (historyActionTypeFilter !== 'ALL') {
          params.set('actionType', historyActionTypeFilter);
        }

        if (historyReviewerFilter.trim()) {
          params.set('reviewer', historyReviewerFilter.trim());
        }

        if (historyDateFrom) {
          params.set('dateFrom', historyDateFrom);
        }

        if (historyDateTo) {
          params.set('dateTo', historyDateTo);
        }

        const response = await fetch(`http://localhost:3001/review-queue/history?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setHistory([]);
          setHistoryTotal(0);
          setHistoryError(payload?.error?.message || REVIEW_HISTORY_LOAD_ERROR_MESSAGE);
          return;
        }

        setHistory(Array.isArray(payload?.data) ? payload.data as ReviewHistoryItem[] : []);
        setHistoryTotal(Number(payload?.pagination?.total || 0));
      } catch {
        setHistory([]);
        setHistoryTotal(0);
        setHistoryError(REVIEW_HISTORY_LOAD_ERROR_MESSAGE);
      } finally {
        setLoadingHistory(false);
      }
    };

    void loadHistory();
  }, [
    activeTab,
    historyActionTypeFilter,
    historyDateFrom,
    historyDateTo,
    historyPage,
    historyPageSize,
    historyReviewerFilter,
    viewerRole,
    viewerSession
  ]);

  useEffect(() => {
    const loadWorkflow = async () => {
      if (!selectedItem) {
        setWorkflow(null);
        setWorkflowError(null);
        return;
      }

      setLoadingWorkflow(true);
      setWorkflowError(null);
      setBanner(null);
      setDecision('APPROVE_AS_SUBMITTED');
      setOverrideInputMode('TARGET_SALARY');
      setOverrideInputValue('');
      setReviewerNotes('');
      setGuardrailResult(null);

      try {
        const params = new URLSearchParams();
        if (viewerRole) {
          params.set('viewerRole', viewerRole);
        }
        if (viewerRole !== 'ADMIN' && viewerSession?.viewer_email) {
          params.set('viewerEmail', viewerSession.viewer_email);
        }
        const query = params.toString();
        const response = await fetch(`http://localhost:3001/cases/by-staff/${encodeURIComponent(selectedItem.staffId)}/workflow${query ? `?${query}` : ''}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setWorkflow(null);
          setWorkflowError(payload?.error?.message || 'Failed to load case review details');
          return;
        }

        setWorkflow(payload?.data || null);
      } catch {
        setWorkflow(null);
        setWorkflowError('Failed to load case review details');
      } finally {
        setLoadingWorkflow(false);
      }
    };

    void loadWorkflow();
  }, [selectedItem, viewerRole, viewerSession]);

  const overridePreview = useMemo(() => {
    return buildOverridePreview(workflow?.currentSalary ?? null, overrideInputMode, overrideInputValue);
  }, [overrideInputMode, overrideInputValue, workflow?.currentSalary]);

  const overrideIsValid = useMemo(() => {
    if (!overridePreview) {
      return false;
    }

    return overridePreview.targetSalary >= 0 && overridePreview.increaseAmount >= 0;
  }, [overridePreview]);

  useEffect(() => {
    const evaluateGuardrails = async () => {
      if (decision !== 'OVERRIDE_AND_APPROVE' || !overridePreview) {
        setGuardrailResult(null);
        return;
      }

      setGuardrailLoading(true);
      try {
        const response = await fetch('http://localhost:3001/guardrails/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            increasePercent: overridePreview.increasePercent,
            increaseAmount: overridePreview.increaseAmount
          })
        });
        const payload = await response.json().catch(() => ({}));
        setGuardrailResult(payload?.data || null);
      } catch {
        setGuardrailResult(null);
      } finally {
        setGuardrailLoading(false);
      }
    };

    void evaluateGuardrails();
  }, [decision, overridePreview]);

  const handleReviewAction = async (nextDecision: ReviewDecision) => {
    if (!workflow) {
      return;
    }

    setSubmitting(true);
    setBanner(null);

    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/recommendation/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: nextDecision,
          reviewerNotes,
          reviewedBy: viewerSession?.viewer_email || 'Reviewer',
          reviewedByRole: viewerRole,
          override: nextDecision === 'OVERRIDE_AND_APPROVE'
            ? {
                inputMode: overrideInputMode,
                inputValue: Number(overrideInputValue),
                recommendationType: 'CUSTOM'
              }
            : null
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBanner(payload?.error?.message || 'Failed to save review decision');
        return;
      }

      setBanner(
        nextDecision === 'REJECT'
          ? 'Recommendation rejected.'
          : nextDecision === 'OVERRIDE_AND_APPROVE'
          ? 'Override approved and saved.'
          : 'Recommendation approved.'
      );
      setWorkflow(payload?.data || null);
      setSelectedItem(null);
      await loadQueue();
    } catch {
      setBanner('Failed to save review decision');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRmOverrideDecision = async (decision: 'approve' | 'reject') => {
    if (!workflow) {
      return;
    }

    setSubmitting(true);
    setBanner(null);

    try {
      const endpoint = decision === 'approve' ? 'approve' : 'reject';
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/rm-override/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          decision === 'approve'
            ? {
                approvedBy: viewerSession?.viewer_email || 'RM',
                actionRole: viewerRole
              }
            : {
                rejectedBy: viewerSession?.viewer_email || 'RM',
                actionRole: viewerRole,
                note: reviewerNotes
              }
        )
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setBanner(payload?.error?.message || 'Failed to process RM override task');
        return;
      }

      setBanner(payload?.data?.message || (decision === 'approve' ? 'RM override approved.' : 'RM override rejected.'));
      setSelectedItem(null);
      setWorkflow(null);
      await loadQueue();
    } catch {
      setBanner('Failed to process RM override task');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmButtonLabel =
    decision === 'APPROVE_AS_SUBMITTED'
      ? 'Confirm Approval'
      : decision === 'OVERRIDE_AND_APPROVE'
        ? 'Confirm Override Approval'
        : 'Confirm Rejection';

  const canConfirmDecision =
    !submitting && (decision !== 'OVERRIDE_AND_APPROVE' || overrideIsValid);

  const isRmOverrideTask = selectedItem?.actionType === 'RM_OVERRIDE_REQUEST' || workflow?.status === 'AWAITING_RM_OVERRIDE_APPROVAL';
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  if (!viewerSession) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Review Queue</h1>
            <p className={styles.subtitle}>Queue shows pending reviewer work. History captures completed decisions.</p>
          </div>
          <div className={styles.summaryPill}>{activeTab === 'queue' ? `${queue.length} awaiting review` : `${historyTotal} historical actions`}</div>
        </div>

        <div className={styles.tabRow}>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'queue' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            Review Queue
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === 'history' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
        </div>

        {activeTab === 'queue' ? (
        <div className={styles.layout}>
          <section className={styles.queuePane}>
            <div className={styles.paneHeader}>Submitted Cases</div>
            {loadingQueue ? <p className={styles.emptyState}>Loading review queue...</p> : null}
            {queueError ? <p className={styles.emptyState}>{queueError}</p> : null}
            {!loadingQueue && !queueError && queue.length === 0 ? <p className={styles.emptyState}>No cases are waiting for review.</p> : null}
            <div className={styles.queueList}>
              {queue.map((item) => (
                <button
                  key={item.caseId}
                  type="button"
                  className={`${styles.queueItem} ${selectedItem?.caseId === item.caseId ? styles.queueItemActive : ''}`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div className={styles.queueItemTop}>
                    <strong>{item.employeeName}</strong>
                    <span className={styles.guardrailBadge}>{item.reasonForReview || getGuardrailMessage(item.guardrailLevel as GuardrailLevel) || '—'}</span>
                  </div>
                  <div className={styles.queueMeta}>{item.client} • {item.role}</div>
                  <div className={styles.queueMetrics}>
                    <span>{formatCompensation(item.currentSalary, { view: 'review-queue', caseStatus: 'SUBMITTED_FOR_REVIEW', conversionRate: phpToAudRate })}</span>
                    <span>{formatCompensation(item.proposedTargetSalary, { view: 'review-queue', caseStatus: 'SUBMITTED_FOR_REVIEW', conversionRate: phpToAudRate })}</span>
                    <span>{formatPercent(item.increasePercent)}</span>
                  </div>
                  <div className={styles.queueMeta}>Submitted by {item.submittedBy || '—'} on {formatDate(item.submittedDate)}</div>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.panelPane}>
            <div className={styles.paneHeader}>Review Panel</div>
            {!selectedItem && !workflow && !loadingWorkflow ? (
              <p className={styles.emptyState}>Select a case to review the submitted recommendation.</p>
            ) : null}
            {loadingWorkflow ? <p className={styles.emptyState}>Loading review details...</p> : null}
            {workflowError ? <p className={styles.emptyState}>{workflowError}</p> : null}
            {banner ? <div className={styles.banner}>{banner}</div> : null}

            {workflow && (isRmOverrideTask || workflow.submittedRecommendation) ? (
              <div className={styles.panelContent}>
                <div className={styles.caseHeader}>
                  <div>
                    <h2 className={styles.caseTitle}>{workflow.fullName}</h2>
                    <p className={styles.caseSubtext}>{workflow.staffId} • {workflow.companyName || selectedItem?.client || '—'} • Current Salary {formatCompensation(workflow.currentSalary, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</p>
                  </div>
                  <div className={styles.statusChip}>{getWorkflowStageLabel(getWorkflowStageFromStatus(workflow.status))}</div>
                </div>

                {isRmOverrideTask ? (
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>RM Override Request</h3>
                    <div className={styles.notesBlock}>
                      <span className={styles.label}>Reason for review</span>
                      <p>RM Override Request</p>
                    </div>
                    <div className={styles.notesBlock}>
                      <span className={styles.label}>Submitted by</span>
                      <p>{selectedItem?.submittedBy || '—'} on {formatDate(selectedItem?.submittedDate)}</p>
                    </div>
                    <div className={styles.decisionRow}>
                      <button
                        type="button"
                        className={`${styles.decisionButton} ${styles.decisionButtonActive}`}
                        disabled={submitting}
                        onClick={() => void handleRmOverrideDecision('approve')}
                      >
                        Approve RM Override
                      </button>
                      <button
                        type="button"
                        className={styles.decisionButton}
                        disabled={submitting}
                        onClick={() => void handleRmOverrideDecision('reject')}
                      >
                        Reject RM Override
                      </button>
                    </div>
                  </div>
                ) : null}

                {!isRmOverrideTask ? (
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>Submitted Recommendation</h3>
                  <div className={styles.summaryGrid}>
                    <div>
                      <span className={styles.label}>Recommendation Type</span>
                      <strong>{workflow.submittedRecommendation?.recommendationType || '—'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Target Salary</span>
                      <strong>{formatCompensation(workflow.submittedRecommendation?.targetSalary, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Increase Amount</span>
                      <strong>{formatCompensation(workflow.submittedRecommendation?.increaseAmount, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Increase Percent</span>
                      <strong>{formatPercent(workflow.submittedRecommendation?.increasePercent)}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Guardrail Guidance</span>
                      <strong>{getGuardrailMessage((workflow.submittedRecommendation?.guardrailLevel || null) as GuardrailLevel | null)}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Submitted</span>
                      <strong>{formatDate(workflow.submittedRecommendation?.submittedAt)}</strong>
                    </div>
                  </div>
                  <div className={styles.notesBlock}>
                    <span className={styles.label}>Manager Justification</span>
                    <p>{workflow.submittedRecommendation?.justification || 'No justification provided.'}</p>
                  </div>
                </div>
                ) : null}

                {!isRmOverrideTask ? (
                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>Reviewer Decision</h3>
                  <div className={styles.decisionRow}>
                    <button
                      type="button"
                      className={`${styles.decisionButton} ${decision === 'APPROVE_AS_SUBMITTED' ? styles.decisionButtonActive : ''}`}
                      onClick={() => setDecision('APPROVE_AS_SUBMITTED')}
                    >
                      Approve as Submitted
                    </button>
                    <button
                      type="button"
                      className={`${styles.decisionButton} ${decision === 'OVERRIDE_AND_APPROVE' ? styles.decisionButtonActive : ''}`}
                      onClick={() => setDecision('OVERRIDE_AND_APPROVE')}
                    >
                      Override and Approve
                    </button>
                    <button
                      type="button"
                      className={`${styles.decisionButton} ${decision === 'REJECT' ? styles.decisionButtonActive : ''}`}
                      onClick={() => setDecision('REJECT')}
                    >
                      Reject
                    </button>
                  </div>
                  <textarea
                    className={styles.notesInput}
                    rows={4}
                    placeholder="Add reviewer notes for audit history or rejection guidance..."
                    value={reviewerNotes}
                    onChange={(event) => setReviewerNotes(event.target.value)}
                  />
                </div>
                ) : null}

                {decision === 'OVERRIDE_AND_APPROVE' && !isRmOverrideTask ? (
                  <div className={styles.card}>
                    <h3 className={styles.cardTitle}>Override Panel</h3>
                    <div className={styles.modeRow}>
                      {([
                        ['TARGET_SALARY', 'Target Salary'],
                        ['INCREASE_AMOUNT', 'Increase Amount'],
                        ['INCREASE_PERCENT', 'Increase Percent']
                      ] as [OverrideInputMode, string][]).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`${styles.modeButton} ${overrideInputMode === mode ? styles.modeButtonActive : ''}`}
                          onClick={() => setOverrideInputMode(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      className={styles.overrideInput}
                      type="number"
                      min={overrideInputMode === 'TARGET_SALARY' ? String(Math.max(0, workflow.currentSalary ?? 0)) : '0'}
                      step={overrideInputMode === 'INCREASE_PERCENT' ? '0.01' : '1'}
                      value={overrideInputValue}
                      onChange={(event) => setOverrideInputValue(event.target.value)}
                      placeholder={overrideInputMode === 'TARGET_SALARY' ? 'Enter target salary' : overrideInputMode === 'INCREASE_AMOUNT' ? 'Enter increase amount' : 'Enter increase percent'}
                    />
                    <div className={styles.summaryGrid}>
                      <div>
                        <span className={styles.label}>Target Salary</span>
                        <strong>{formatCompensation(overridePreview?.targetSalary, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Increase Amount</span>
                        <strong>{formatCompensation(overridePreview?.increaseAmount, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Increase Percent</span>
                        <strong>{formatPercent(overridePreview?.increasePercent)}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Guardrail</span>
                        <strong>{guardrailLoading ? 'Evaluating…' : getGuardrailMessage(guardrailResult?.guardrailLevel || null)}</strong>
                      </div>
                    </div>
                    {guardrailResult ? <p className={styles.guardrailText}>{getGuardrailMessage(guardrailResult.guardrailLevel)}</p> : null}
                  </div>
                ) : null}

                {!isRmOverrideTask ? (
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryAction}
                    disabled={!canConfirmDecision}
                    onClick={() => void handleReviewAction(decision)}
                  >
                    {confirmButtonLabel}
                  </button>
                </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
        ) : (
          <section className={styles.historyPane}>
            <div className={styles.historyFilters}>
              <select
                className={styles.historyFilterSelect}
                aria-label="Filter by action type"
                title="Filter by action type"
                value={historyActionTypeFilter}
                onChange={(event) => {
                  setHistoryActionTypeFilter(event.target.value);
                  setHistoryPage(1);
                }}
              >
                <option value="ALL">Action Type: All</option>
                <option value="RM_OVERRIDE_APPROVED">RM Override Approved</option>
                <option value="RM_OVERRIDE_REJECTED">RM Override Rejected</option>
                <option value="RECOMMENDATION_APPROVED">Recommendation Approved</option>
                <option value="RECOMMENDATION_REJECTED">Recommendation Rejected</option>
              </select>
              <input
                className={styles.historyFilterInput}
                type="text"
                aria-label="Filter by reviewer"
                title="Filter by reviewer"
                placeholder="Reviewer email contains..."
                value={historyReviewerFilter}
                onChange={(event) => {
                  setHistoryReviewerFilter(event.target.value);
                  setHistoryPage(1);
                }}
              />
              <input
                className={styles.historyFilterInput}
                type="date"
                aria-label="Filter from date"
                title="Filter from date"
                value={historyDateFrom}
                onChange={(event) => {
                  setHistoryDateFrom(event.target.value);
                  setHistoryPage(1);
                }}
              />
              <input
                className={styles.historyFilterInput}
                type="date"
                aria-label="Filter to date"
                title="Filter to date"
                value={historyDateTo}
                onChange={(event) => {
                  setHistoryDateTo(event.target.value);
                  setHistoryPage(1);
                }}
              />
            </div>

            {loadingHistory ? <p className={styles.emptyState}>Loading review history...</p> : null}
            {historyError ? <p className={styles.emptyState}>{historyError}</p> : null}
            {!loadingHistory && !historyError && history.length === 0 ? <p className={styles.emptyState}>No completed review actions found.</p> : null}

            {!loadingHistory && !historyError && history.length > 0 ? (
              <div className={styles.historyTableWrap}>
                <table className={styles.historyTable}>
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Employee</th>
                      <th>Company</th>
                      <th>Action Type</th>
                      <th>Previous Status</th>
                      <th>New Status</th>
                      <th>Reviewed By</th>
                      <th>Date</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id}>
                        <td>{item.caseId}</td>
                        <td>{item.employeeName}</td>
                        <td>{item.company || '—'}</td>
                        <td>{item.actionType.replace(/_/g, ' ')}</td>
                        <td>{formatHistoryWorkflowStatus(item.previousStatus)}</td>
                        <td>{formatHistoryWorkflowStatus(item.newStatus)}</td>
                        <td>{item.actionBy}{item.actionRole ? ` (${item.actionRole})` : ''}</td>
                        <td>{formatDate(item.actionTimestamp)}</td>
                        <td>{item.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className={styles.historyPagination}>
              <span>Page {historyPage} of {historyTotalPages}</span>
              <select
                className={styles.historyFilterSelect}
                aria-label="History page size"
                title="History page size"
                value={historyPageSize}
                onChange={(event) => {
                  setHistoryPageSize(Number(event.target.value));
                  setHistoryPage(1);
                }}
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
              <button
                type="button"
                className={styles.decisionButton}
                onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                disabled={historyPage <= 1 || loadingHistory}
              >
                Previous
              </button>
              <button
                type="button"
                className={styles.decisionButton}
                onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
                disabled={historyPage >= historyTotalPages || loadingHistory}
              >
                Next
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default ReviewQueuePage;
