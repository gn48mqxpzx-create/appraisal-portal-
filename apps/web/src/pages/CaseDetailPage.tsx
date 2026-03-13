import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, formatWsll, getPhpToAudRate } from '../utils/currencyDisplay';
import styles from './CaseDetailPage.module.css';

interface Employee {
  staff_id?: string;
  staffId?: string;
  full_name?: string;
  fullName?: string;
  email?: string;
  staff_role?: string;
  staffRole?: string;
  staff_start_date?: string;
  staffStartDate?: string;
  // sm/rm may be a display name or HubSpot owner ID depending on the source
  sm?: string;
  sm_owner_id?: string;
  rm?: string;
  rm_name?: string;
}

interface CaseDetailPageProps {
  staffId: string;
  viewerSession: ViewerSession | null;
  onNavigateBack: () => void;
}

interface CurrentCompensationRecord {
  staffId: string;
  currentCompensation: number | string;
  currency: string;
  effectiveDate: string;
}

type BenchmarkStatus =
  | 'READY'
  | 'MISSING_ROLE_MAPPING'
  | 'MISSING_STANDARDIZED_ROLE'
  | 'MISSING_MARKET_MATRIX'
  | 'MISSING_CURRENT_COMPENSATION'
  | 'MISSING_START_DATE';

interface BenchmarkSummary {
  staffId: string;
  fullName: string;
  rawRole: string | null;
  standardizedRole: string | null;
  matchSource: string | null;
  confidenceScore: number | null;
  staffStartDate: string | null;
  tenureDisplay: string | null;
  tenureBand: 'T1' | 'T2' | 'T3' | 'T4' | null;
  currentCompensation: number | string | null;
  currency: string | null;
  effectiveDate: string | null;
  marketMin: number | string | null;
  marketMax: number | string | null;
  marketMidpoint: number | string | null;
  gapToMidpoint: number | string | null;
  benchmarkStatus: BenchmarkStatus;
}

type RecommendationOption = 'low' | 'mid' | 'high' | 'custom';
type CustomInputMode = 'targetSalary' | 'increaseAmount' | 'increasePercent';
type GuardrailLevel = 'Green' | 'Yellow' | 'Red' | 'Unknown';

interface GuardrailResult {
  guardrailLevel: GuardrailLevel;
  colorCode: string;
  actionRequired: string;
  matchedByPercent: GuardrailLevel;
  matchedByAmount: GuardrailLevel;
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
  successManager?: string | null;
  relationshipManager?: string | null;
  wsllEligibilityStatus?: 'PASS' | 'MISSING_WSLL' | 'WSLL_BELOW_THRESHOLD';
  wsllEligibilityMessage?: string | null;
  wsllAverageWsll?: number | null;
  submittedRecommendation: WorkflowRecommendation | null;
  finalRecommendation: WorkflowRecommendation | null;
}

function GuardrailBadge({ result, loading }: { result: GuardrailResult | null; loading: boolean }) {
  if (loading) return <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Evaluating…</span>;
  if (!result) return null;
  const bg = result.colorCode + '22';
  const border = result.colorCode + '55';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, backgroundColor: bg, color: result.colorCode, border: `1px solid ${border}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: result.colorCode, display: 'inline-block', flexShrink: 0 }} />
      {result.guardrailLevel} — {result.actionRequired}
    </span>
  );
}

const WORKFLOW_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED_FOR_REVIEW: 'Submitted for Review',
  REVIEW_APPROVED: 'Review Approved',
  REVIEW_REJECTED: 'Review Rejected',
  PENDING_CLIENT_APPROVAL: 'Pending Client Approval',
  CLIENT_APPROVED: 'Client Approved',
  SUBMITTED_TO_PAYROLL: 'Submitted to Payroll'
};

const toRecommendationType = (option: RecommendationOption) => {
  switch (option) {
    case 'low':
      return 'LOW';
    case 'mid':
      return 'MID';
    case 'high':
      return 'HIGH';
    case 'custom':
      return 'CUSTOM';
  }
};

const fromRecommendationType = (value: string | null | undefined): RecommendationOption => {
  switch (value) {
    case 'LOW':
      return 'low';
    case 'HIGH':
      return 'high';
    case 'CUSTOM':
      return 'custom';
    case 'MID':
    default:
      return 'mid';
  }
};

const toCustomInputMode = (mode: CustomInputMode) => {
  switch (mode) {
    case 'targetSalary':
      return 'TARGET_SALARY';
    case 'increaseAmount':
      return 'INCREASE_AMOUNT';
    case 'increasePercent':
      return 'INCREASE_PERCENT';
  }
};

const fromCustomInputMode = (mode: string | null | undefined): CustomInputMode => {
  switch (mode) {
    case 'INCREASE_AMOUNT':
      return 'increaseAmount';
    case 'INCREASE_PERCENT':
      return 'increasePercent';
    case 'TARGET_SALARY':
    default:
      return 'targetSalary';
  }
};

export function CaseDetailPage({ staffId, viewerSession, onNavigateBack }: CaseDetailPageProps) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [currentCompensation, setCurrentCompensation] = useState<CurrentCompensationRecord | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationOption>('mid');
  const [customInputMode, setCustomInputMode] = useState<CustomInputMode>('targetSalary');
  const [customInputValue, setCustomInputValue] = useState<string>('');
  const [customConfirmed, setCustomConfirmed] = useState(false);
  const [confirmedCustomCalc, setConfirmedCustomCalc] = useState<{
    targetSalary: number;
    increaseAmount: number;
    increasePercent: number;
  } | null>(null);
  const [guardrailResult, setGuardrailResult] = useState<GuardrailResult | null>(null);
  const [guardrailLoading, setGuardrailLoading] = useState(false);
  const [justificationText, setJustificationText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const phpToAudRate = useMemo(() => getPhpToAudRate(), []);

  useEffect(() => {
    if (viewerSession) {
      const virtualAssistants = viewerSession.virtual_assistants || [];
      let found = virtualAssistants.find((emp: Employee) => (emp.staff_id || emp.staffId) === staffId);

      if (!found && viewerSession.success_managers) {
        const successManagers = viewerSession.success_managers || [];
        found = successManagers.find((emp: Employee) => (emp.staff_id || emp.staffId) === staffId);
      }

      setEmployee(found || null);
    }
  }, [staffId, viewerSession]);

  useEffect(() => {
    const loadCurrentCompensation = async () => {
      try {
        const response = await fetch(`http://localhost:3001/compensation/current/${encodeURIComponent(staffId)}`);
        const data = await response.json();
        setCurrentCompensation(data?.data || null);
      } catch {
        setCurrentCompensation(null);
      }
    };

    void loadCurrentCompensation();
  }, [staffId]);

  useEffect(() => {
    const loadBenchmark = async () => {
      setBenchmarkLoading(true);
      setBenchmarkError(null);

      try {
        const response = await fetch(`http://localhost:3001/cases/benchmark/${encodeURIComponent(staffId)}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setBenchmark(null);
          setBenchmarkError(payload?.error?.message || 'Failed to load benchmark summary');
          return;
        }

        setBenchmark(payload?.data || null);
      } catch {
        setBenchmark(null);
        setBenchmarkError('Failed to load benchmark summary');
      } finally {
        setBenchmarkLoading(false);
      }
    };

    void loadBenchmark();
  }, [staffId]);

  const loadWorkflow = async () => {
    setWorkflowLoading(true);
    setWorkflowError(null);

    try {
      const response = await fetch(`http://localhost:3001/cases/by-staff/${encodeURIComponent(staffId)}/workflow`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setWorkflow(null);
        setWorkflowError(payload?.error?.message || 'Failed to load case workflow');
        return;
      }

      setWorkflow(payload?.data || null);
    } catch {
      setWorkflow(null);
      setWorkflowError('Failed to load case workflow');
    } finally {
      setWorkflowLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkflow();
  }, [staffId]);

  useEffect(() => {
    if (!workflow?.submittedRecommendation) {
      return;
    }

    const submitted = workflow.submittedRecommendation;
    setSelectedRecommendation(fromRecommendationType(submitted.recommendationType));
    setJustificationText(submitted.justification || '');

    if (submitted.recommendationType === 'CUSTOM') {
      const nextMode = fromCustomInputMode(submitted.customInputMode);
      setCustomInputMode(nextMode);
      setCustomConfirmed(true);
      setConfirmedCustomCalc(
        submitted.targetSalary !== null && submitted.increaseAmount !== null && submitted.increasePercent !== null
          ? {
              targetSalary: submitted.targetSalary,
              increaseAmount: submitted.increaseAmount,
              increasePercent: submitted.increasePercent
            }
          : null
      );
      const nextValue =
        nextMode === 'targetSalary'
          ? submitted.targetSalary
          : nextMode === 'increaseAmount'
          ? submitted.increaseAmount
          : submitted.increasePercent;
      setCustomInputValue(nextValue !== null && nextValue !== undefined ? String(nextValue) : '');
    }
  }, [workflow?.submittedRecommendation]);

  useEffect(() => {
    if (!benchmark) return;
    const midpoint = benchmark.marketMidpoint !== null ? Number(benchmark.marketMidpoint) : null;
    if (midpoint !== null && Number.isFinite(midpoint) && !workflow?.submittedRecommendation) {
      setCustomInputValue(String(midpoint));
    }
  }, [benchmark, workflow?.submittedRecommendation]);

  const calculateTenure = (startDate: string | undefined): string => {
    if (!startDate) return '—';
    try {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) return '—';
      const now = new Date();
      const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());

      if (totalMonths < 0) return '—';
      if (totalMonths === 0) return '0m';

      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;

      if (years === 0) {
        return `${months}m`;
      }
      if (months === 0) {
        return `${years}y`;
      }
      return `${years}y ${months}m`;
    } catch {
      return '—';
    }
  };

  const formatDate = (dateStr: string | undefined | null): string => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  const currentCaseStatus = workflow?.status || null;

  const formatCurrency = (value: number | string | null | undefined, currency?: string | null): string => {
    void currency;
    return formatCompensation(value, {
      view: 'case-detail',
      caseStatus: currentCaseStatus,
      conversionRate: phpToAudRate
    });
  };

  const benchmarkStatusMessage: Record<BenchmarkStatus, string> = {
    READY: 'Benchmark inputs are complete and the market comparison is ready.',
    MISSING_ROLE_MAPPING: 'This employee role has not been mapped into the role library yet.',
    MISSING_STANDARDIZED_ROLE: 'The role mapping exists, but it is not linked to a standardized role record.',
    MISSING_MARKET_MATRIX: 'No market matrix row exists yet for this standardized role and tenure band.',
    MISSING_CURRENT_COMPENSATION: 'Current compensation data is missing for this staff member.',
    MISSING_START_DATE: 'Staff start date is missing, so tenure and benchmark band cannot be resolved.'
  };

  const benchmarkReady = benchmark?.benchmarkStatus === 'READY';
  const isSubmitted = workflow?.status === 'SUBMITTED_FOR_REVIEW';
  const isApprovedState = ['REVIEW_APPROVED', 'PENDING_CLIENT_APPROVAL', 'CLIENT_APPROVED', 'SUBMITTED_TO_PAYROLL'].includes(workflow?.status || '');
  const isRejected = workflow?.status === 'REVIEW_REJECTED';
  const managerCanEdit = !isSubmitted && !isApprovedState;
  const wsllEligibilityStatus = workflow?.wsllEligibilityStatus ?? 'MISSING_WSLL';
  const wsllRecommendationAllowed = wsllEligibilityStatus === 'PASS';
  const wsllBlockerMessage = workflow?.wsllEligibilityMessage
    || (wsllEligibilityStatus === 'WSLL_BELOW_THRESHOLD'
      ? 'Employee is not eligible for appraisal because average WSLL is below 2.8.'
      : 'WSLL data is required before a recommendation can be created.');

  const recommendationBlockerMessages: Partial<Record<BenchmarkStatus, string>> = {
    MISSING_ROLE_MAPPING: 'Role must be mapped before a recommendation can be created.',
    MISSING_STANDARDIZED_ROLE: 'Role must be mapped before a recommendation can be created.',
    MISSING_MARKET_MATRIX: 'A market matrix must exist before a recommendation can be created.',
    MISSING_CURRENT_COMPENSATION: 'Current compensation is required before a recommendation can be created.',
    MISSING_START_DATE: 'Start date is required before a recommendation can be created.'
  };

  const marketRange = benchmark?.marketMin && benchmark?.marketMax
    ? `${formatCurrency(benchmark.marketMin, benchmark.currency)} - ${formatCurrency(benchmark.marketMax, benchmark.currency)}`
    : '—';

  const currentSalary = benchmark?.currentCompensation !== null && benchmark?.currentCompensation !== undefined
    ? Number(benchmark.currentCompensation)
    : null;
  const marketMinValue = benchmark?.marketMin !== null && benchmark?.marketMin !== undefined ? Number(benchmark.marketMin) : null;
  const marketMidpointValue = benchmark?.marketMidpoint !== null && benchmark?.marketMidpoint !== undefined ? Number(benchmark.marketMidpoint) : null;
  const marketMaxValue = benchmark?.marketMax !== null && benchmark?.marketMax !== undefined ? Number(benchmark.marketMax) : null;

  const liveCustomTargetSalary = useMemo((): number | null => {
    if (!customInputValue.trim() || currentSalary === null || !Number.isFinite(currentSalary)) return null;
    const value = Number(customInputValue);
    if (!Number.isFinite(value)) return null;
    if (customInputMode === 'targetSalary') return value;
    if (customInputMode === 'increaseAmount') return currentSalary + value;
    return currentSalary + (currentSalary * value) / 100;
  }, [customInputValue, customInputMode, currentSalary]);

  const calculateRecommendation = (targetSalary: number | null) => {
    if (targetSalary === null || !Number.isFinite(targetSalary) || currentSalary === null || !Number.isFinite(currentSalary) || currentSalary <= 0) {
      return {
        targetSalary: null,
        increaseAmount: null,
        increasePercent: null
      };
    }

    const increaseAmount = targetSalary - currentSalary;
    const increasePercent = (increaseAmount / currentSalary) * 100;

    return {
      targetSalary,
      increaseAmount,
      increasePercent
    };
  };

  const recommendations = useMemo(
    () => ({
      low: {
        ...calculateRecommendation(marketMinValue),
        description: 'Move to market minimum'
      },
      mid: {
        ...calculateRecommendation(marketMidpointValue),
        description: 'Align to market midpoint'
      },
      high: {
        ...calculateRecommendation(marketMaxValue),
        description: 'Align to market maximum'
      },
      custom: {
        ...calculateRecommendation(liveCustomTargetSalary),
        description: 'Manager-defined adjustment'
      }
    }),
    [marketMinValue, marketMidpointValue, marketMaxValue, liveCustomTargetSalary, currentSalary]
  );

  const formatPercent = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  useEffect(() => {
    const evaluateGuardrails = async (increasePercent: number, increaseAmount: number) => {
      setGuardrailLoading(true);
      setGuardrailResult(null);
      try {
        const res = await fetch('http://localhost:3001/guardrails/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ increasePercent, increaseAmount })
        });
        const data = await res.json();
        setGuardrailResult(data?.data || null);
      } catch {
        setGuardrailResult(null);
      } finally {
        setGuardrailLoading(false);
      }
    };

    if (!managerCanEdit) {
      return;
    }

    if (selectedRecommendation === 'custom') return;
    if (!benchmarkReady) {
      setGuardrailResult(null);
      return;
    }
    const recommendation = recommendations[selectedRecommendation];
    if (recommendation.increasePercent !== null && recommendation.increaseAmount !== null) {
      void evaluateGuardrails(recommendation.increasePercent, recommendation.increaseAmount);
    } else {
      setGuardrailResult(null);
    }
  }, [benchmarkReady, managerCanEdit, recommendations, selectedRecommendation]);

  useEffect(() => {
    if (selectedRecommendation !== 'custom') {
      setCustomConfirmed(false);
      setConfirmedCustomCalc(null);
    }
  }, [selectedRecommendation]);

  useEffect(() => {
    if (!managerCanEdit) {
      return;
    }

    setCustomConfirmed(false);
    setConfirmedCustomCalc(null);
    setGuardrailResult(null);
  }, [customInputMode, customInputValue, managerCanEdit]);

  const handleConfirmCustom = async () => {
    const calculation = recommendations.custom;
    if (calculation.targetSalary === null || calculation.increaseAmount === null || calculation.increasePercent === null) return;

    setConfirmedCustomCalc(calculation as { targetSalary: number; increaseAmount: number; increasePercent: number; });
    setCustomConfirmed(true);

    setGuardrailLoading(true);
    try {
      const res = await fetch('http://localhost:3001/guardrails/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ increasePercent: calculation.increasePercent, increaseAmount: calculation.increaseAmount })
      });
      const data = await res.json();
      setGuardrailResult(data?.data || null);
    } catch {
      setGuardrailResult(null);
    } finally {
      setGuardrailLoading(false);
    }
  };

  const activeCalculation = selectedRecommendation === 'custom' && customConfirmed ? confirmedCustomCalc : recommendations[selectedRecommendation];

  const canSubmitForReview = useMemo(() => {
    if (!managerCanEdit) return false;
    if (!benchmarkReady) return false;
    if (!wsllRecommendationAllowed) return false;
    if (guardrailLoading || !guardrailResult) return false;
    if (selectedRecommendation === 'custom' && !customConfirmed) return false;
    if (guardrailResult.guardrailLevel === 'Red' || guardrailResult.guardrailLevel === 'Unknown') return false;
    if (guardrailResult.guardrailLevel === 'Yellow') return justificationText.trim().length > 0;
    return true;
  }, [benchmarkReady, customConfirmed, guardrailLoading, guardrailResult, justificationText, managerCanEdit, selectedRecommendation, wsllRecommendationAllowed]);

  const approvedSummary = workflow?.finalRecommendation || workflow?.submittedRecommendation;

  const handleSubmitForReview = async () => {
    if (!workflow?.caseId || !activeCalculation || activeCalculation.targetSalary === null || activeCalculation.increaseAmount === null || activeCalculation.increasePercent === null) {
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/recommendation/submit-for-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendationType: toRecommendationType(selectedRecommendation),
          targetSalary: activeCalculation.targetSalary,
          increaseAmount: activeCalculation.increaseAmount,
          increasePercent: activeCalculation.increasePercent,
          customInputMode: selectedRecommendation === 'custom' ? toCustomInputMode(customInputMode) : null,
          justification: justificationText,
          submittedBy: viewerSession?.viewer_email || 'Manager'
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionMessage(payload?.error?.message || 'Failed to submit recommendation');
        return;
      }

      setWorkflow(payload?.data || null);
      setActionMessage('Recommendation submitted for review. The manager input is now locked.');
    } catch {
      setActionMessage('Failed to submit recommendation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSecureClientApproval = async () => {
    if (!workflow?.caseId) {
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/secure-client-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: viewerSession?.viewer_name || 'Manager' })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionMessage(payload?.error?.message || 'Failed to move case to client approval');
        return;
      }

      await loadWorkflow();
      setActionMessage('Case moved to pending client approval.');
    } catch {
      setActionMessage('Failed to move case to client approval');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitToPayroll = async () => {
    if (!workflow?.caseId) {
      return;
    }

    setSubmitting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/submit-to-payroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submittedBy: viewerSession?.viewer_email || 'Manager' })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionMessage(payload?.error?.message || 'Failed to submit case to payroll');
        return;
      }

      await loadWorkflow();
      setActionMessage('Case marked as submitted to payroll.');
    } catch {
      setActionMessage('Failed to submit case to payroll');
    } finally {
      setSubmitting(false);
    }
  };

  if (!employee && !benchmarkLoading && !benchmark) {
    return (
      <div className={styles.container}>
        <div className={styles.innerContainer}>
          <button onClick={onNavigateBack} className={styles.backButton}>← Back to Cases</button>
          <div className={styles.errorState}>
            <p className={styles.errorText}>Employee not found</p>
          </div>
        </div>
      </div>
    );
  }

  const fullName = employee?.full_name || employee?.fullName || benchmark?.fullName || '—';
  const email = employee?.email || '—';
  const role = employee?.staff_role || employee?.staffRole || benchmark?.rawRole || '—';
  const startDate = employee?.staff_start_date || employee?.staffStartDate || benchmark?.staffStartDate || undefined;
  const tenure = calculateTenure(startDate);
  const formattedStartDate = formatDate(startDate);
  // SM fallback chain:
  // 1. workflow.successManager — resolved by backend (intake name → directory lookup)
  // 2. employee.sm — direct field if present in session data
  // 3. employee.sm_owner_id — raw HubSpot owner ID (last resort, not a display name)
  const successManager = workflow?.successManager || employee?.sm || employee?.sm_owner_id || '—';
  // RM fallback chain:
  // 1. workflow.relationshipManager — resolved by backend
  // 2. employee.rm — direct field from session directory data
  // 3. employee.rm_name — alternate field name
  const reportingManager = workflow?.relationshipManager || employee?.rm || employee?.rm_name || '—';

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        <div className={styles.headerSection}>
          <button onClick={onNavigateBack} className={styles.backButton}>← Back to Cases</button>
          <h1 className={styles.title}>Appraisal Case</h1>
        </div>

        {workflowLoading ? <div className={styles.infoBanner}>Loading workflow...</div> : null}
        {workflowError ? <div className={styles.warningBanner}>{workflowError}</div> : null}
        {actionMessage ? <div className={styles.infoBanner}>{actionMessage}</div> : null}
        {workflow ? <div className={styles.statusBanner}>{WORKFLOW_LABELS[workflow.status] || workflow.status}</div> : null}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Employee Profile</h2>
          <div className={styles.cardContent}>
            <div className={styles.profileGrid}>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Staff ID</label>
                <div className={styles.fieldValue}><code className={styles.staffIdCode}>{staffId}</code></div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Full Name</label>
                <div className={styles.fieldValue}>{fullName}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Email</label>
                <div className={styles.fieldValue}>{email}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Role</label>
                <div className={styles.fieldValue}>{role}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Start Date</label>
                <div className={styles.fieldValue}>{formattedStartDate}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Tenure</label>
                <div className={styles.fieldValue}><strong>{tenure}</strong></div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Success Manager</label>
                <div className={styles.fieldValue}>{successManager}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Reporting Manager</label>
                <div className={styles.fieldValue}>{reportingManager}</div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Compensation</h2>
          <div className={styles.cardContent}>
            <div className={styles.compensationGrid}>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>Current Compensation</label>
                <div className={styles.fieldValue}>{formatCurrency(currentCompensation?.currentCompensation, currentCompensation?.currency)}</div>
              </div>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>Effective Date</label>
                <div className={styles.fieldValue}>{formatDate(currentCompensation?.effectiveDate)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Benchmark & Recommendation</h2>
          <div className={styles.cardContent}>
            {benchmarkLoading && <p className={styles.infoText}>Loading benchmark summary...</p>}
            {!benchmarkLoading && benchmarkError && (
              <div className={styles.benchmarkNotice}>
                <p className={styles.benchmarkNoticeText}>{benchmarkError}</p>
              </div>
            )}

            {!benchmarkLoading && !benchmarkError && benchmark && (
              <>
                <div className={styles.benchmarkMiniGrid}>
                  <div className={styles.benchmarkMiniItem}>
                    <p className={styles.benchmarkMiniLabel}>Current Compensation</p>
                    <p className={styles.benchmarkMiniValue}>{formatCurrency(benchmark.currentCompensation, benchmark.currency)}</p>
                  </div>
                  <div className={styles.benchmarkMiniItem}>
                    <p className={styles.benchmarkMiniLabel}>Market Range</p>
                    <p className={styles.benchmarkMiniValue}>{marketRange}</p>
                  </div>
                  <div className={styles.benchmarkMiniItem}>
                    <p className={styles.benchmarkMiniLabel}>Market Midpoint</p>
                    <p className={styles.benchmarkMiniValue}>{formatCurrency(benchmark.marketMidpoint, benchmark.currency)}</p>
                  </div>
                </div>

                {benchmark.benchmarkStatus !== 'READY' && (
                  <div className={styles.benchmarkNotice}>
                    <p className={styles.benchmarkNoticeText}>{benchmarkStatusMessage[benchmark.benchmarkStatus]}</p>
                  </div>
                )}

                {benchmarkReady && !wsllRecommendationAllowed && (
                  <div className={styles.warningBanner}>
                    {wsllBlockerMessage}
                    {workflow?.wsllAverageWsll != null && (
                      <span style={{ marginLeft: '8px', fontWeight: 600 }}>
                        (Avg WSLL: {formatWsll(workflow.wsllAverageWsll)})
                      </span>
                    )}
                  </div>
                )}

                {isRejected && workflow?.finalRecommendation?.reviewerNotes ? (
                  <div className={styles.warningBanner}>Reviewer notes: {workflow.finalRecommendation.reviewerNotes}</div>
                ) : null}

                {isApprovedState && approvedSummary ? (
                  <div className={styles.summaryCard}>
                    <h3 className={styles.recommendationTitle}>Approved Recommendation</h3>
                    <div className={styles.summaryGrid}>
                      <div>
                        <span className={styles.fieldLabel}>Target Salary</span>
                        <div className={styles.summaryValue}>{formatCurrency(approvedSummary.targetSalary, benchmark.currency)}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Increase Amount</span>
                        <div className={styles.summaryValue}>{formatCurrency(approvedSummary.increaseAmount, benchmark.currency)}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Increase Percent</span>
                        <div className={styles.summaryValue}>{formatPercent(approvedSummary.increasePercent)}</div>
                      </div>
                    </div>
                    {workflow?.finalRecommendation?.reviewerNotes ? <p className={styles.infoText}>Reviewer Notes: {workflow.finalRecommendation.reviewerNotes}</p> : null}
                  </div>
                ) : isSubmitted && workflow?.submittedRecommendation ? (
                  <div className={styles.summaryCard}>
                    <h3 className={styles.recommendationTitle}>Submitted Recommendation</h3>
                    <div className={styles.summaryGrid}>
                      <div>
                        <span className={styles.fieldLabel}>Recommendation Type</span>
                        <div className={styles.summaryValue}>{workflow.submittedRecommendation.recommendationType || '—'}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Target Salary</span>
                        <div className={styles.summaryValue}>{formatCurrency(workflow.submittedRecommendation.targetSalary, benchmark.currency)}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Increase Amount</span>
                        <div className={styles.summaryValue}>{formatCurrency(workflow.submittedRecommendation.increaseAmount, benchmark.currency)}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Increase Percent</span>
                        <div className={styles.summaryValue}>{formatPercent(workflow.submittedRecommendation.increasePercent)}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Guardrail Level</span>
                        <div className={styles.summaryValue}>{workflow.submittedRecommendation.guardrailLevel || '—'}</div>
                      </div>
                      <div>
                        <span className={styles.fieldLabel}>Submitted At</span>
                        <div className={styles.summaryValue}>{formatDate(workflow.submittedRecommendation.submittedAt)}</div>
                      </div>
                    </div>
                    <p className={styles.infoText}>Recommendation inputs are locked while the case is in review.</p>
                  </div>
                ) : (
                  <section className={styles.recommendationSection}>
                    <h3 className={styles.recommendationTitle}>Recommendation</h3>

                    {!benchmarkReady && (
                      <div className={styles.warningBanner}>
                        {recommendationBlockerMessages[benchmark.benchmarkStatus] ?? 'Benchmark is not ready. A recommendation cannot be created.'}
                      </div>
                    )}

                    <div className={styles.recommendationGrid}>
                      {(['low', 'mid', 'high', 'custom'] as RecommendationOption[]).map((option) => {
                        const recommendation = option === 'custom' && customConfirmed && confirmedCustomCalc ? confirmedCustomCalc : recommendations[option];
                        const name = option.charAt(0).toUpperCase() + option.slice(1);
                        const cardClass = option === 'low' ? styles.lowCard : option === 'mid' ? styles.midCard : option === 'high' ? styles.highCard : styles.customCard;
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={!benchmarkReady || !managerCanEdit || !wsllRecommendationAllowed}
                            className={`${styles.recommendationCard} ${cardClass} ${selectedRecommendation === option ? styles.recommendationCardSelected : ''}`}
                            onClick={() => setSelectedRecommendation(option)}
                            style={{ opacity: benchmarkReady && managerCanEdit && wsllRecommendationAllowed ? 1 : 0.45, cursor: benchmarkReady && managerCanEdit && wsllRecommendationAllowed ? 'pointer' : 'not-allowed' }}
                          >
                            <p className={styles.recommendationName}>{name}</p>
                            <p className={styles.recommendationMetric}>Target: {formatCurrency(recommendation.targetSalary, benchmark.currency)}</p>
                            <p className={styles.recommendationMetric}>Increase: {formatCurrency(recommendation.increaseAmount, benchmark.currency)}</p>
                            <p className={styles.recommendationMetric}>{formatPercent(recommendation.increasePercent)}</p>
                            <p className={styles.recommendationDescription}>{recommendations[option].description}</p>
                          </button>
                        );
                      })}
                    </div>

                    {selectedRecommendation === 'custom' && benchmarkReady && managerCanEdit && wsllRecommendationAllowed ? (
                      <div className={styles.customInputWrap}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                          {([
                            ['targetSalary', 'Target Salary'],
                            ['increaseAmount', 'Increase Amount'],
                            ['increasePercent', 'Increase %']
                          ] as [CustomInputMode, string][]).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setCustomInputMode(mode)}
                              style={{
                                padding: '5px 14px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 500,
                                border: customInputMode === mode ? '1px solid #111827' : '1px solid #e5e7eb',
                                background: customInputMode === mode ? '#111827' : '#fff',
                                color: customInputMode === mode ? '#fff' : '#374151',
                                cursor: 'pointer'
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <label className={styles.fieldLabel} htmlFor="custom-value-input">
                          {customInputMode === 'targetSalary' ? 'Target Salary' : customInputMode === 'increaseAmount' ? 'Increase Amount' : 'Increase Percent (%)'}
                        </label>
                        <input
                          id="custom-value-input"
                          type="number"
                          min="0"
                          step={customInputMode === 'increasePercent' ? '0.01' : '1'}
                          className={styles.customTargetInput}
                          value={customInputValue}
                          onChange={(event) => setCustomInputValue(event.target.value)}
                        />
                        {!customConfirmed && recommendations.custom.targetSalary !== null ? (
                          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                            Preview → Target: {formatCurrency(recommendations.custom.targetSalary, benchmark.currency)} · Increase: {formatCurrency(recommendations.custom.increaseAmount, benchmark.currency)} · {formatPercent(recommendations.custom.increasePercent)}
                          </p>
                        ) : null}
                        {!customConfirmed ? (
                          <button type="button" disabled={recommendations.custom.targetSalary === null || !wsllRecommendationAllowed} onClick={() => void handleConfirmCustom()} className={styles.inlineActionButton}>
                            Confirm Custom Recommendation
                          </button>
                        ) : (
                          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Custom recommendation confirmed</span>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomConfirmed(false);
                                setConfirmedCustomCalc(null);
                                setGuardrailResult(null);
                              }}
                              style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {(selectedRecommendation !== 'custom' || customConfirmed) && managerCanEdit && wsllRecommendationAllowed ? (
                      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Guardrail:</span>
                          <GuardrailBadge result={guardrailResult} loading={guardrailLoading} />
                        </div>

                        {guardrailResult?.guardrailLevel === 'Yellow' ? (
                          <div className={styles.justificationBox}>
                            <p className={styles.justificationTitle}>Manager Justification Required</p>
                            <p className={styles.justificationText}>This increase falls in the Yellow guardrail band. Provide a justification before submitting.</p>
                            <textarea
                              rows={3}
                              placeholder="Explain the business justification for this increase..."
                              value={justificationText}
                              onChange={(event) => setJustificationText(event.target.value)}
                              className={styles.justificationInput}
                            />
                          </div>
                        ) : null}

                        {guardrailResult?.guardrailLevel === 'Red' ? (
                          <div className={styles.benchmarkNotice}>
                            <p className={styles.benchmarkNoticeText}>This increase exceeds the Red guardrail threshold. Normal submission is disabled.</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                )}
              </>
            )}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Manager Notes</h2>
          <div className={styles.cardContent}>
            <textarea
              className={styles.notesTextarea}
              placeholder="Add notes about this case..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={6}
            />
          </div>
        </div>

        <div className={styles.workflowActionBar}>
          {managerCanEdit ? (
            <button
              type="button"
              disabled={!canSubmitForReview || submitting}
              className={`${styles.workflowButton} ${styles.workflowPrimary}`}
              onClick={() => void handleSubmitForReview()}
              style={{ opacity: canSubmitForReview && !submitting ? 1 : 0.45, cursor: canSubmitForReview && !submitting ? 'pointer' : 'not-allowed' }}
            >
              Submit for Review
            </button>
          ) : null}
          {workflow?.status === 'REVIEW_APPROVED' ? (
            <button type="button" disabled={submitting} className={`${styles.workflowButton} ${styles.workflowSecondary}`} onClick={() => void handleSecureClientApproval()}>
              Secure Client Approval
            </button>
          ) : null}
          {workflow?.status === 'CLIENT_APPROVED' ? (
            <button type="button" disabled={submitting} className={`${styles.workflowButton} ${styles.workflowSuccess}`} onClick={() => void handleSubmitToPayroll()}>
              Submit to Payroll
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default CaseDetailPage;
