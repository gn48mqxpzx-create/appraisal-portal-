import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, formatWsll, getPhpToAudRate } from '../utils/currencyDisplay';
import { getWorkflowStageFromStatus, getWorkflowStageLabel } from '../utils/workflowStage';
import styles from './CaseDetailPage.module.css';

interface CaseDetailPageProps {
  staffId: string;
  viewerSession: ViewerSession | null;
  onNavigateBack: () => void;
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
  email: string | null;
  companyName: string | null;
  rawRole: string | null;
  hubspotRole: string | null;
  normalizedRole: string | null;
  normalizedRoleStatus: string | null;
  standardizedRole: string | null;
  matchSource: string | null;
  confidenceScore: number | null;
  staffStartDate: string | null;
  successManager: string | null;
  relationshipManager: string | null;
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
  companyName: string | null;
  status: string;
  rmOverrideStatus: 'NOT_REQUIRED' | 'REQUESTED' | 'APPROVED';
  currentSalary: number | null;
  successManager?: string | null;
  relationshipManager?: string | null;
  wsllEligibilityStatus?: 'PASS' | 'MISSING_WSLL' | 'WSLL_BELOW_THRESHOLD';
  wsllEligibilityMessage?: string | null;
  wsllAverageWsll?: number | null;
  appraisalClassification?: {
    wsllStatus: 'WITH_WSLL' | 'NO_WSLL';
    wsllReason: 'PASS' | 'NO_DATA' | 'BELOW_THRESHOLD';
    tenureGroup: 'TENURED' | 'LESS_THAN_12_MONTHS';
    marketPosition: 'BELOW_MARKET' | 'AT_OR_ABOVE_MARKET';
    rmApprovalRequired: boolean;
    appraisalCategory: string;
  } | null;
  submittedRecommendation: WorkflowRecommendation | null;
  finalRecommendation: WorkflowRecommendation | null;
}

const formatTenureGroup = (value: 'TENURED' | 'LESS_THAN_12_MONTHS' | undefined) =>
  value === 'TENURED' ? 'Tenured' : 'Less than 12 Months';

const formatMarketPosition = (value: 'BELOW_MARKET' | 'AT_OR_ABOVE_MARKET' | undefined) =>
  value === 'BELOW_MARKET' ? 'Below Market' : 'At or Above Market';

const formatWsllStatus = (value: 'WITH_WSLL' | 'NO_WSLL' | undefined) =>
  value === 'WITH_WSLL' ? 'With WSLL' : 'No WSLL';

const formatAppraisalCategory = (value: string | undefined | null): string => {
  if (!value) return '—';

  return value
    .split(' - ')
    .map((part) => part
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    )
    .join(' · ');
};

const getGuardrailMessage = (guardrailLevel: GuardrailLevel): string => {
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

function GuardrailBadge({ result, loading }: { result: GuardrailResult | null; loading: boolean }) {
  if (loading) return <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Evaluating…</span>;
  if (!result) return null;
  const bg = result.colorCode + '22';
  const border = result.colorCode + '55';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700, backgroundColor: bg, color: result.colorCode, border: `1px solid ${border}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: result.colorCode, display: 'inline-block', flexShrink: 0 }} />
      {getGuardrailMessage(result.guardrailLevel)}
    </span>
  );
}

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
  const [notes, setNotes] = useState<string>('');
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
    const loadBenchmark = async () => {
      setBenchmarkLoading(true);
      setBenchmarkError(null);

      try {
        const params = new URLSearchParams();
        const viewerRole = viewerSession?.role === 'Admin' ? 'ADMIN' : viewerSession?.role;
        if (viewerRole) {
          params.set('viewerRole', viewerRole);
        }
        if (viewerRole && viewerRole !== 'ADMIN' && viewerSession?.viewer_email) {
          params.set('viewerEmail', viewerSession.viewer_email);
        }
        const query = params.toString();
        const response = await fetch(`http://localhost:3001/cases/benchmark/${encodeURIComponent(staffId)}${query ? `?${query}` : ''}`);
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
  }, [staffId, viewerSession]);

  const loadWorkflow = async () => {
    setWorkflowLoading(true);
    setWorkflowError(null);

    try {
      const params = new URLSearchParams();
      const viewerRole = viewerSession?.role === 'Admin' ? 'ADMIN' : viewerSession?.role;
      if (viewerRole) {
        params.set('viewerRole', viewerRole);
      }
      if (viewerRole && viewerRole !== 'ADMIN' && viewerSession?.viewer_email) {
        params.set('viewerEmail', viewerSession.viewer_email);
      }
      const query = params.toString();
      const response = await fetch(`http://localhost:3001/cases/by-staff/${encodeURIComponent(staffId)}/workflow${query ? `?${query}` : ''}`);
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
  }, [staffId, viewerSession]);

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
  const isApprovedState = ['REVIEW_APPROVED', 'AWAITING_CLIENT_APPROVAL', 'PENDING_CLIENT_APPROVAL', 'CLIENT_APPROVED', 'SUBMITTED_TO_PAYROLL'].includes(workflow?.status || '');
  const isRejected = workflow?.status === 'REVIEW_REJECTED';
  const managerCanEdit = !isSubmitted && !isApprovedState;
  const wsllEligibilityStatus = workflow?.wsllEligibilityStatus ?? 'MISSING_WSLL';
  const wsllBlockerMessage = workflow?.wsllEligibilityMessage
    || (wsllEligibilityStatus === 'WSLL_BELOW_THRESHOLD'
      ? 'Average WSLL is below 2.8.'
      : 'WSLL data is not available.');
  const classification = workflow?.appraisalClassification ?? null;
  const rmOverrideRequired = classification?.rmApprovalRequired ?? false;
  const rmOverrideApproved = workflow?.rmOverrideStatus === 'APPROVED';
  const recommendationLockedByOverride = rmOverrideRequired && !rmOverrideApproved;
  const rmOverrideMessage = rmOverrideRequired
    ? rmOverrideApproved
      ? 'RM override approved. You may now proceed with the salary recommendation or custom adjustment for this employee.'
      : 'RM override required before recommendation.'
    : 'Within recommended range';

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

  const customHasValidInput = useMemo(() => {
    if (selectedRecommendation !== 'custom') {
      return false;
    }

    const calc = recommendations.custom;
    if (calc.targetSalary === null || calc.increaseAmount === null || calc.increasePercent === null) {
      return false;
    }

    return calc.targetSalary >= 0 && calc.increaseAmount >= 0;
  }, [recommendations.custom, selectedRecommendation]);

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
      return;
    }

    setCustomInputValue('');
    setCustomConfirmed(false);
    setConfirmedCustomCalc(null);
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
    if (!customHasValidInput || calculation.targetSalary === null || calculation.increaseAmount === null || calculation.increasePercent === null) return;

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
    if (recommendationLockedByOverride) return false;
    if (guardrailLoading || !guardrailResult) return false;
    if (selectedRecommendation === 'custom' && !customConfirmed) return false;
    if (guardrailResult.guardrailLevel === 'Red' || guardrailResult.guardrailLevel === 'Unknown') return false;
    if (guardrailResult.guardrailLevel === 'Yellow') return justificationText.trim().length > 0;
    return true;
  }, [benchmarkReady, customConfirmed, guardrailLoading, guardrailResult, justificationText, managerCanEdit, selectedRecommendation, recommendationLockedByOverride]);

  const handleRequestRmOverride = async () => {
    if (!workflow?.caseId) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/rm-override/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedBy: viewerSession?.viewer_email || viewerSession?.viewer_name || 'Manager' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionMessage(payload?.error?.message || 'Failed to request RM override');
        return;
      }
      await loadWorkflow();
      setActionMessage(payload?.data?.message || 'RM override request submitted.');
    } catch {
      setActionMessage('Failed to request RM override');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveRmOverride = async () => {
    if (!workflow?.caseId) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`http://localhost:3001/cases/${workflow.caseId}/rm-override/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: viewerSession?.viewer_email || viewerSession?.viewer_name || 'RM' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionMessage(payload?.error?.message || 'Failed to approve RM override');
        return;
      }
      await loadWorkflow();
      setActionMessage(payload?.data?.message || 'RM override approved.');
    } catch {
      setActionMessage('Failed to approve RM override');
    } finally {
      setSubmitting(false);
    }
  };

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

  if (!benchmarkLoading && !benchmark && !workflow) {
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

  const fullName = workflow?.fullName || benchmark?.fullName || '—';
  const email = benchmark?.email || '—';
  const company = workflow?.companyName || benchmark?.companyName || '—';
  const role = benchmark?.rawRole || '—';
  const startDate = benchmark?.staffStartDate || undefined;
  const tenure = calculateTenure(startDate);
  const formattedStartDate = formatDate(startDate);
  const successManager = workflow?.successManager || benchmark?.successManager || '—';
  const reportingManager = workflow?.relationshipManager || benchmark?.relationshipManager || '—';

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
        {workflow ? <div className={styles.statusBanner}>{getWorkflowStageLabel(getWorkflowStageFromStatus(workflow.status))}</div> : null}

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
                <label className={styles.fieldLabel}>Company</label>
                <div className={styles.fieldValue}>{company}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>HubSpot Role</label>
                <div className={styles.fieldValue}>{benchmark?.hubspotRole || benchmark?.rawRole || '—'}</div>
              </div>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Normalized Role</label>
                <div className={styles.fieldValue}>
                  {benchmark?.normalizedRole
                    ? <>
                        {benchmark.normalizedRole}
                        {benchmark.normalizedRoleStatus === 'UNMAPPED' && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>Unmapped</span>}
                        {benchmark.normalizedRoleStatus === 'WEAK_MATCH' && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#92400e', background: '#fde68a', padding: '1px 6px', borderRadius: 4 }}>Weak Match</span>}
                      </>
                    : '—'}
                </div>
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
                <div className={styles.fieldValue}>{formatCurrency(benchmark?.currentCompensation, benchmark?.currency)}</div>
              </div>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>Effective Date</label>
                <div className={styles.fieldValue}>{formatDate(benchmark?.effectiveDate)}</div>
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

                {classification ? (
                  <div className={styles.classificationRibbon}>
                    <div className={styles.classificationRow}>
                      <span className={`${styles.classificationChip} ${classification.wsllStatus === 'NO_WSLL' ? styles.chipAmber : styles.chipGreen}`}>
                        {formatWsllStatus(classification.wsllStatus)}
                      </span>
                      <span className={`${styles.classificationChip} ${styles.chipNeutral}`}>
                        {formatTenureGroup(classification.tenureGroup)}
                      </span>
                      <span className={`${styles.classificationChip} ${classification.marketPosition === 'BELOW_MARKET' ? styles.chipBlue : styles.chipNeutral}`}>
                        {formatMarketPosition(classification.marketPosition)}
                      </span>
                      <span className={`${styles.classificationChip} ${classification.rmApprovalRequired ? styles.chipAmber : styles.chipGreen}`}>
                        {classification.rmApprovalRequired ? (rmOverrideApproved ? 'No WSLL, RM Approved' : 'RM Override Required') : 'Within recommended range'}
                      </span>
                    </div>
                    <div className={styles.classificationCategory}>
                      <span className={styles.classificationCategoryValue}>{formatAppraisalCategory(classification.appraisalCategory)}</span>
                    </div>
                  </div>
                ) : null}

                {benchmarkReady && rmOverrideRequired && (
                  <div className={styles.warningBanner}>
                    {rmOverrideMessage}
                    <span style={{ marginLeft: '8px', fontWeight: 600 }}>
                      ({wsllBlockerMessage}{workflow?.wsllAverageWsll != null ? ` Avg WSLL: ${formatWsll(workflow.wsllAverageWsll)}` : ''})
                    </span>
                  </div>
                )}

                {recommendationLockedByOverride ? (
                  <div className={styles.warningBanner}>
                    Recommendation cards are locked until RM override is approved.
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(viewerSession?.role === 'SM' || viewerSession?.role === 'Admin') && (
                        <button
                          type="button"
                          className={styles.inlineActionButton}
                          disabled={submitting || workflow?.rmOverrideStatus === 'REQUESTED'}
                          onClick={() => void handleRequestRmOverride()}
                        >
                          {workflow?.rmOverrideStatus === 'REQUESTED' ? 'RM Override Requested' : 'Request RM Override'}
                        </button>
                      )}
                      {(viewerSession?.role === 'RM' || viewerSession?.role === 'Admin') && (
                        <button
                          type="button"
                          className={styles.inlineActionButton}
                          disabled={submitting}
                          onClick={() => void handleApproveRmOverride()}
                        >
                          Approve RM Override
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                {isRejected ? (
                  <div className={styles.infoBanner}>Recommendation rejected. Update the recommendation and resubmit when ready.</div>
                ) : null}
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
                        <span className={styles.fieldLabel}>Guardrail Guidance</span>
                        <div className={styles.summaryValue}>{workflow.submittedRecommendation.guardrailLevel ? getGuardrailMessage(workflow.submittedRecommendation.guardrailLevel as GuardrailLevel) : '—'}</div>
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
                            disabled={!benchmarkReady || !managerCanEdit || recommendationLockedByOverride}
                            className={`${styles.recommendationCard} ${cardClass} ${selectedRecommendation === option ? styles.recommendationCardSelected : ''}`}
                            onClick={() => setSelectedRecommendation(option)}
                            style={{ opacity: benchmarkReady && managerCanEdit && !recommendationLockedByOverride ? 1 : 0.45, cursor: benchmarkReady && managerCanEdit && !recommendationLockedByOverride ? 'pointer' : 'not-allowed' }}
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

                    {selectedRecommendation === 'custom' && benchmarkReady && managerCanEdit && !recommendationLockedByOverride ? (
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
                          min={customInputMode === 'targetSalary' ? String(Math.max(0, currentSalary ?? 0)) : '0'}
                          step={customInputMode === 'increasePercent' ? '0.01' : '1'}
                          className={styles.customTargetInput}
                          value={customInputValue}
                          onChange={(event) => setCustomInputValue(event.target.value)}
                        />
                        {!customConfirmed && customHasValidInput ? (
                          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                            Preview → Target: {formatCurrency(recommendations.custom.targetSalary, benchmark.currency)} · Increase: {formatCurrency(recommendations.custom.increaseAmount, benchmark.currency)} · {formatPercent(recommendations.custom.increasePercent)}
                          </p>
                        ) : null}
                        {!customConfirmed ? (
                          <button type="button" disabled={!customHasValidInput} onClick={() => void handleConfirmCustom()} className={styles.inlineActionButton}>
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

                    {(selectedRecommendation !== 'custom' || customConfirmed) && managerCanEdit && !recommendationLockedByOverride ? (
                      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Guardrail:</span>
                          <GuardrailBadge result={guardrailResult} loading={guardrailLoading} />
                        </div>

                        {guardrailResult?.guardrailLevel === 'Green' ? (
                          <div className={styles.guardrailInfoBar}>Within recommended range.</div>
                        ) : null}

                        {guardrailResult?.guardrailLevel === 'Yellow' ? (
                          <div className={styles.guardrailSoftPanel}>
                            <p className={styles.justificationTitle}>Manager justification required</p>
                            <p className={styles.justificationText}>Manager justification required before submission.</p>
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
                          <div className={styles.guardrailStrongPanel}>
                            <p className={styles.benchmarkNoticeText}>Executive approval required before submission.</p>
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
          {workflow?.status === 'AWAITING_CLIENT_APPROVAL' || workflow?.status === 'REVIEW_APPROVED' ? (
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
