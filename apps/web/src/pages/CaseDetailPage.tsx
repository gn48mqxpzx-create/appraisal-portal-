import { useState, useEffect, useMemo, useCallback } from 'react';
import { ViewerSession } from '../utils/auth';
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
  sm?: string;
  rm?: string;
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

export function CaseDetailPage({ staffId, viewerSession, onNavigateBack }: CaseDetailPageProps) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [currentCompensation, setCurrentCompensation] = useState<CurrentCompensationRecord | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
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

  useEffect(() => {
    // Find the employee from the viewer session
    if (viewerSession) {
      // Search in virtual_assistants first
      const virtualAssistants = viewerSession.virtual_assistants || [];
      let found = virtualAssistants.find((emp: Employee) => 
        (emp.staff_id || emp.staffId) === staffId
      );
      
      // If not found and success_managers exists, search there too (for Admin/RM)
      if (!found && viewerSession.success_managers) {
        const successManagers = viewerSession.success_managers || [];
        found = successManagers.find((emp: Employee) => 
          (emp.staff_id || emp.staffId) === staffId
        );
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

  useEffect(() => {
    if (!benchmark) return;
    const midpoint = benchmark.marketMidpoint !== null ? Number(benchmark.marketMidpoint) : null;
    if (midpoint !== null && Number.isFinite(midpoint)) {
      setCustomInputValue(String(midpoint));
    }
  }, [benchmark]);

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
      } else if (months === 0) {
        return `${years}y`;
      } else {
        return `${years}y ${months}m`;
      }
    } catch {
      return '—';
    }
  };

  const formatDate = (dateStr: string | undefined): string => {
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

  const formatCurrency = (value: number | string | null | undefined, currency: string | null | undefined): string => {
    if (value === null || value === undefined) {
      return '—';
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return '—';
    }

    const resolvedCurrency = currency || 'AUD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: resolvedCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(parsed);
    } catch {
      return `${resolvedCurrency} ${parsed.toFixed(2)}`;
    }
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

  const recommendationBlockerMessages: Partial<Record<BenchmarkStatus, string>> = {
    MISSING_ROLE_MAPPING: 'Role must be mapped before a recommendation can be created.',
    MISSING_STANDARDIZED_ROLE: 'Role must be mapped before a recommendation can be created.',
    MISSING_MARKET_MATRIX: 'A market matrix must exist before a recommendation can be created.',
    MISSING_CURRENT_COMPENSATION: 'Current compensation is required before a recommendation can be created.',
    MISSING_START_DATE: 'Start date is required before a recommendation can be created.',
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
  // Resolve live custom target salary from chosen input mode
  const liveCustomTargetSalary = useMemo((): number | null => {
    if (!customInputValue.trim() || currentSalary === null || !Number.isFinite(currentSalary)) return null;
    const v = Number(customInputValue);
    if (!Number.isFinite(v)) return null;
    if (customInputMode === 'targetSalary') return v;
    if (customInputMode === 'increaseAmount') return currentSalary + v;
    if (customInputMode === 'increasePercent') return currentSalary + (currentSalary * v) / 100;
    return null;
  }, [customInputValue, customInputMode, currentSalary]);

  const calculateRecommendation = (targetSalary: number | null) => {
    if (
      targetSalary === null ||
      !Number.isFinite(targetSalary) ||
      currentSalary === null ||
      !Number.isFinite(currentSalary) ||
      currentSalary <= 0
    ) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marketMinValue, marketMidpointValue, marketMaxValue, liveCustomTargetSalary, currentSalary]
  );

  const formatPercent = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  // ── Guardrail evaluation ──────────────────────────────────────────────────

  const evaluateGuardrails = useCallback(async (increasePercent: number, increaseAmount: number) => {
    setGuardrailLoading(true);
    setGuardrailResult(null);
    try {
      const res = await fetch('http://localhost:3001/guardrails/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ increasePercent, increaseAmount }),
      });
      const data = await res.json();
      setGuardrailResult(data?.data || null);
    } catch {
      setGuardrailResult(null);
    } finally {
      setGuardrailLoading(false);
    }
  }, []);

  // Auto-evaluate for low/mid/high when selected or calculations change
  useEffect(() => {
    if (selectedRecommendation === 'custom') return;
    if (!benchmarkReady) { setGuardrailResult(null); return; }
    const rec = recommendations[selectedRecommendation];
    if (
      rec.increasePercent !== null &&
      rec.increaseAmount !== null &&
      Number.isFinite(rec.increasePercent) &&
      Number.isFinite(rec.increaseAmount)
    ) {
      void evaluateGuardrails(rec.increasePercent, rec.increaseAmount);
    } else {
      setGuardrailResult(null);
    }
    setJustificationText('');
  }, [selectedRecommendation, recommendations, evaluateGuardrails, benchmarkReady]);

  // Clear custom confirmation when switching away from custom
  useEffect(() => {
    if (selectedRecommendation !== 'custom') {
      setCustomConfirmed(false);
      setConfirmedCustomCalc(null);
    }
  }, [selectedRecommendation]);

  // Reset confirmation when custom input changes
  useEffect(() => {
    setCustomConfirmed(false);
    setConfirmedCustomCalc(null);
    setGuardrailResult(null);
    setJustificationText('');
  }, [customInputValue, customInputMode]);

  const handleConfirmCustom = async () => {
    const calc = recommendations.custom;
    if (calc.targetSalary === null || calc.increaseAmount === null || calc.increasePercent === null) return;
    setConfirmedCustomCalc({
      targetSalary: calc.targetSalary,
      increaseAmount: calc.increaseAmount,
      increasePercent: calc.increasePercent,
    });
    setCustomConfirmed(true);
    setJustificationText('');
    await evaluateGuardrails(calc.increasePercent, calc.increaseAmount);
  };

  // Submit gating
  const canSubmitForReview = useMemo((): boolean => {
    if (!benchmarkReady) return false;
    if (guardrailLoading || !guardrailResult) return false;
    if (selectedRecommendation === 'custom' && !customConfirmed) return false;
    if (guardrailResult.guardrailLevel === 'Red' || guardrailResult.guardrailLevel === 'Unknown') return false;
    if (guardrailResult.guardrailLevel === 'Yellow') return justificationText.trim().length > 0;
    return true;
  }, [benchmarkReady, guardrailResult, guardrailLoading, selectedRecommendation, customConfirmed, justificationText]);

  const handleSubmitForReview = () => {
    console.log('Submit for Review', { guardrailResult, justificationText });
  };

  const handleSecureClientApproval = () => {
    console.log('Secure Client Approval clicked');
  };

  const handleSubmitToPayroll = () => {
    console.log('Submit to Payroll clicked');
  };

  if (!employee) {
    return (
      <div className={styles.container}>
        <div className={styles.innerContainer}>
          <button onClick={onNavigateBack} className={styles.backButton}>
            ← Back to Cases
          </button>
          <div className={styles.errorState}>
            <p className={styles.errorText}>Employee not found</p>
          </div>
        </div>
      </div>
    );
  }

  const fullName = employee.full_name || employee.fullName || '—';
  const email = employee.email || '—';
  const role = employee.staff_role || employee.staffRole || '—';
  const startDate = employee.staff_start_date || employee.staffStartDate;
  const tenure = calculateTenure(startDate);
  const formattedStartDate = formatDate(startDate);
  const successManager = employee.sm || '—';
  const reportingManager = employee.rm || '—';

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        {/* Header with Back Button */}
        <div className={styles.headerSection}>
          <button onClick={onNavigateBack} className={styles.backButton}>
            ← Back to Cases
          </button>
          <h1 className={styles.title}>Appraisal Case</h1>
        </div>

        {/* Employee Profile Card */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Employee Profile</h2>
          <div className={styles.cardContent}>
            <div className={styles.profileGrid}>
              <div className={styles.profileField}>
                <label className={styles.fieldLabel}>Staff ID</label>
                <div className={styles.fieldValue}>
                  <code className={styles.staffIdCode}>{staffId}</code>
                </div>
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
                <div className={styles.fieldValue}>
                  <strong>{tenure}</strong>
                </div>
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

        {/* Compensation Section */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Compensation</h2>
          <div className={styles.cardContent}>
            <div className={styles.compensationGrid}>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>Current Compensation</label>
                <div className={styles.fieldValue}>
                  {formatCurrency(currentCompensation?.currentCompensation, currentCompensation?.currency)}
                </div>
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

                <section className={styles.recommendationSection}>
                  <h3 className={styles.recommendationTitle}>Recommendation</h3>

                  {!benchmarkReady && (
                    <div style={{
                      background: '#fff7ed',
                      border: '1px solid #fed7aa',
                      borderRadius: 8,
                      padding: '12px 16px',
                      marginBottom: 16,
                    }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#9a3412' }}>
                        {recommendationBlockerMessages[benchmark.benchmarkStatus] ?? 'Benchmark is not ready. A recommendation cannot be created.'}
                      </p>
                    </div>
                  )}
                  <div className={styles.recommendationGrid}>
                    <button
                      type="button"
                      disabled={!benchmarkReady}
                      className={`${styles.recommendationCard} ${styles.lowCard} ${selectedRecommendation === 'low' ? styles.recommendationCardSelected : ''}`}
                      onClick={() => setSelectedRecommendation('low')}
                      style={{ opacity: benchmarkReady ? 1 : 0.45, cursor: benchmarkReady ? 'pointer' : 'not-allowed' }}
                    >
                      <p className={styles.recommendationName}>Low</p>
                      <p className={styles.recommendationMetric}>Target: {formatCurrency(recommendations.low.targetSalary, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>Increase: {formatCurrency(recommendations.low.increaseAmount, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>{formatPercent(recommendations.low.increasePercent)}</p>
                      <p className={styles.recommendationDescription}>{recommendations.low.description}</p>
                    </button>

                    <button
                      type="button"
                      disabled={!benchmarkReady}
                      className={`${styles.recommendationCard} ${styles.midCard} ${selectedRecommendation === 'mid' ? styles.recommendationCardSelected : ''}`}
                      onClick={() => setSelectedRecommendation('mid')}
                      style={{ opacity: benchmarkReady ? 1 : 0.45, cursor: benchmarkReady ? 'pointer' : 'not-allowed' }}
                    >
                      <p className={styles.recommendationName}>Mid</p>
                      <p className={styles.recommendationMetric}>Target: {formatCurrency(recommendations.mid.targetSalary, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>Increase: {formatCurrency(recommendations.mid.increaseAmount, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>{formatPercent(recommendations.mid.increasePercent)}</p>
                      <p className={styles.recommendationDescription}>{recommendations.mid.description}</p>
                    </button>

                    <button
                      type="button"
                      disabled={!benchmarkReady}
                      className={`${styles.recommendationCard} ${styles.highCard} ${selectedRecommendation === 'high' ? styles.recommendationCardSelected : ''}`}
                      onClick={() => setSelectedRecommendation('high')}
                      style={{ opacity: benchmarkReady ? 1 : 0.45, cursor: benchmarkReady ? 'pointer' : 'not-allowed' }}
                    >
                      <p className={styles.recommendationName}>High</p>
                      <p className={styles.recommendationMetric}>Target: {formatCurrency(recommendations.high.targetSalary, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>Increase: {formatCurrency(recommendations.high.increaseAmount, benchmark.currency)}</p>
                      <p className={styles.recommendationMetric}>{formatPercent(recommendations.high.increasePercent)}</p>
                      <p className={styles.recommendationDescription}>{recommendations.high.description}</p>
                    </button>

                    <button
                      type="button"
                      disabled={!benchmarkReady}
                      className={`${styles.recommendationCard} ${styles.customCard} ${selectedRecommendation === 'custom' ? styles.recommendationCardSelected : ''}`}
                      onClick={() => setSelectedRecommendation('custom')}
                      style={{ opacity: benchmarkReady ? 1 : 0.45, cursor: benchmarkReady ? 'pointer' : 'not-allowed' }}
                    >
                      <p className={styles.recommendationName}>Custom</p>
                      {customConfirmed && confirmedCustomCalc ? (
                        <>
                          <p className={styles.recommendationMetric}>Target: {formatCurrency(confirmedCustomCalc.targetSalary, benchmark.currency)}</p>
                          <p className={styles.recommendationMetric}>Increase: {formatCurrency(confirmedCustomCalc.increaseAmount, benchmark.currency)}</p>
                          <p className={styles.recommendationMetric}>{formatPercent(confirmedCustomCalc.increasePercent)}</p>
                        </>
                      ) : (
                        <>
                          <p className={styles.recommendationMetric}>Target: {formatCurrency(recommendations.custom.targetSalary, benchmark.currency)}</p>
                          <p className={styles.recommendationMetric}>Increase: {formatCurrency(recommendations.custom.increaseAmount, benchmark.currency)}</p>
                          <p className={styles.recommendationMetric}>{formatPercent(recommendations.custom.increasePercent)}</p>
                        </>
                      )}
                      <p className={styles.recommendationDescription}>{customConfirmed ? 'Confirmed' : 'Manager-defined adjustment'}</p>
                    </button>
                  </div>

                  {selectedRecommendation === 'custom' && benchmarkReady && (
                    <div className={styles.customInputWrap}>
                      {/* Input mode selector */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                        {(
                          [
                            ['targetSalary', 'Target Salary'],
                            ['increaseAmount', 'Increase Amount'],
                            ['increasePercent', 'Increase %'],
                          ] as [CustomInputMode, string][]
                        ).map(([mode, label]) => (
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
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <label className={styles.fieldLabel} htmlFor="custom-value-input">
                        {customInputMode === 'targetSalary' && 'Target Salary'}
                        {customInputMode === 'increaseAmount' && 'Increase Amount'}
                        {customInputMode === 'increasePercent' && 'Increase Percent (%)'}
                      </label>
                      <input
                        id="custom-value-input"
                        type="number"
                        min="0"
                        step={customInputMode === 'increasePercent' ? '0.01' : '1'}
                        className={styles.customTargetInput}
                        value={customInputValue}
                        onChange={(e) => setCustomInputValue(e.target.value)}
                        placeholder={
                          customInputMode === 'targetSalary'
                            ? 'Enter target salary'
                            : customInputMode === 'increaseAmount'
                            ? 'Enter increase amount'
                            : 'Enter increase percent'
                        }
                      />

                      {!customConfirmed && recommendations.custom.targetSalary !== null && (
                        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                          Preview → Target: {formatCurrency(recommendations.custom.targetSalary, benchmark.currency)}&nbsp;·&nbsp;
                          Increase: {formatCurrency(recommendations.custom.increaseAmount, benchmark.currency)}&nbsp;·&nbsp;
                          {formatPercent(recommendations.custom.increasePercent)}
                        </p>
                      )}

                      {!customConfirmed ? (
                        <button
                          type="button"
                          disabled={recommendations.custom.targetSalary === null}
                          onClick={() => void handleConfirmCustom()}
                          style={{
                            marginTop: 12,
                            padding: '8px 20px',
                            background: recommendations.custom.targetSalary !== null ? '#111827' : '#e5e7eb',
                            color: recommendations.custom.targetSalary !== null ? '#fff' : '#9ca3af',
                            border: 'none',
                            borderRadius: 7,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: recommendations.custom.targetSalary !== null ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Confirm Custom Recommendation
                        </button>
                      ) : (
                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                            ✓ Custom recommendation confirmed
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomConfirmed(false);
                              setConfirmedCustomCalc(null);
                              setGuardrailResult(null);
                              setJustificationText('');
                            }}
                            style={{
                              fontSize: 12,
                              color: '#6b7280',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Guardrail result display */}
                  {(selectedRecommendation !== 'custom' || customConfirmed) && (
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Guardrail:</span>
                        <GuardrailBadge result={guardrailResult} loading={guardrailLoading} />
                      </div>

                      {guardrailResult?.guardrailLevel === 'Yellow' && (
                        <div
                          style={{
                            background: '#fefce8',
                            border: '1px solid #fde68a',
                            borderRadius: 8,
                            padding: '14px 16px',
                          }}
                        >
                          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                            Manager Justification Required
                          </p>
                          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#78350f' }}>
                            This increase falls in the Yellow guardrail band. Provide a justification before submitting.
                          </p>
                          <textarea
                            rows={3}
                            placeholder="Explain the business justification for this increase…"
                            value={justificationText}
                            onChange={(e) => setJustificationText(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              border: '1px solid #fcd34d',
                              borderRadius: 6,
                              fontSize: 13,
                              resize: 'vertical',
                              boxSizing: 'border-box',
                              background: '#fff',
                            }}
                          />
                        </div>
                      )}

                      {guardrailResult?.guardrailLevel === 'Red' && (
                        <div
                          style={{
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: 8,
                            padding: '14px 16px',
                          }}
                        >
                          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>
                            Executive Override Required
                          </p>
                          <p style={{ margin: 0, fontSize: 12, color: '#991b1b' }}>
                            This increase exceeds the Red guardrail threshold. Normal submission is disabled.
                            An executive override process must be initiated separately.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>

        {/* Manager Notes Section */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Manager Notes</h2>
          <div className={styles.cardContent}>
            <textarea
              className={styles.notesTextarea}
              placeholder="Add notes about this case..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
            />
          </div>
        </div>

        <div className={styles.workflowActionBar}>
          <button
            type="button"
            disabled={!canSubmitForReview}
            className={`${styles.workflowButton} ${styles.workflowPrimary}`}
            onClick={handleSubmitForReview}
            style={{ opacity: canSubmitForReview ? 1 : 0.45, cursor: canSubmitForReview ? 'pointer' : 'not-allowed' }}
          >
            Submit for Review
          </button>
          <button type="button" className={`${styles.workflowButton} ${styles.workflowSecondary}`} onClick={handleSecureClientApproval}>
            Secure Client Approval
          </button>
          <button type="button" className={`${styles.workflowButton} ${styles.workflowSuccess}`} onClick={handleSubmitToPayroll}>
            Submit to Payroll
          </button>
        </div>
      </div>
    </div>
  );
}

export default CaseDetailPage;
