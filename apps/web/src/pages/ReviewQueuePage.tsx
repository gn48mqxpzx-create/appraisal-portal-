import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, getPhpToAudRate } from '../utils/currencyDisplay';
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
  status: string;
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
        setQueueError(payload?.error?.message || 'Failed to load review queue');
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
      setQueueError('Failed to load review queue');
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, [viewerRole, viewerSession]);

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

  const selectedDecisionLabel =
    decision === 'APPROVE_AS_SUBMITTED'
      ? 'Approve as Submitted'
      : decision === 'OVERRIDE_AND_APPROVE'
      ? 'Override and Approve'
      : 'Reject';

  if (!viewerSession) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Review Queue</h1>
            <p className={styles.subtitle}>Cases submitted for review stay here until they are approved, overridden, or rejected.</p>
          </div>
          <div className={styles.summaryPill}>{queue.length} awaiting review</div>
        </div>

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
                    <span className={styles.guardrailBadge}>{item.guardrailLevel || '—'}</span>
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

            {workflow && workflow.submittedRecommendation ? (
              <div className={styles.panelContent}>
                <div className={styles.caseHeader}>
                  <div>
                    <h2 className={styles.caseTitle}>{workflow.fullName}</h2>
                    <p className={styles.caseSubtext}>{workflow.staffId} • Current Salary {formatCompensation(workflow.currentSalary, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</p>
                  </div>
                  <div className={styles.statusChip}>{workflow.status.replace(/_/g, ' ')}</div>
                </div>

                <div className={styles.card}>
                  <h3 className={styles.cardTitle}>Submitted Recommendation</h3>
                  <div className={styles.summaryGrid}>
                    <div>
                      <span className={styles.label}>Recommendation Type</span>
                      <strong>{workflow.submittedRecommendation.recommendationType || '—'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Target Salary</span>
                      <strong>{formatCompensation(workflow.submittedRecommendation.targetSalary, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Increase Amount</span>
                      <strong>{formatCompensation(workflow.submittedRecommendation.increaseAmount, { view: 'review-queue', caseStatus: workflow.status, conversionRate: phpToAudRate })}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Increase Percent</span>
                      <strong>{formatPercent(workflow.submittedRecommendation.increasePercent)}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Guardrail Level</span>
                      <strong>{workflow.submittedRecommendation.guardrailLevel || '—'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Submitted</span>
                      <strong>{formatDate(workflow.submittedRecommendation.submittedAt)}</strong>
                    </div>
                  </div>
                  <div className={styles.notesBlock}>
                    <span className={styles.label}>Manager Justification</span>
                    <p>{workflow.submittedRecommendation.justification || 'No justification provided.'}</p>
                  </div>
                </div>

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
                  <p className={styles.selectionText}>Selected: {selectedDecisionLabel}</p>
                  <textarea
                    className={styles.notesInput}
                    rows={4}
                    placeholder="Add reviewer notes for audit history or rejection guidance..."
                    value={reviewerNotes}
                    onChange={(event) => setReviewerNotes(event.target.value)}
                  />
                </div>

                {decision === 'OVERRIDE_AND_APPROVE' ? (
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
                      min="0"
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
                        <strong>{guardrailLoading ? 'Evaluating…' : guardrailResult?.guardrailLevel || '—'}</strong>
                      </div>
                    </div>
                    {guardrailResult ? <p className={styles.guardrailText}>{guardrailResult.actionRequired}</p> : null}
                  </div>
                ) : null}

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryAction}
                    disabled={submitting}
                    onClick={() => void handleReviewAction('APPROVE_AS_SUBMITTED')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    disabled={submitting || !overridePreview}
                    onClick={() => void handleReviewAction('OVERRIDE_AND_APPROVE')}
                  >
                    Approve with Override
                  </button>
                  <button
                    type="button"
                    className={styles.rejectAction}
                    disabled={submitting}
                    onClick={() => void handleReviewAction('REJECT')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export default ReviewQueuePage;
