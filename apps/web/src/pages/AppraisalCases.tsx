import { Fragment, useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, getPhpToAudRate } from '../utils/currencyDisplay';
import { getWorkflowStageFromStatus, getWorkflowStageLabel, WORKFLOW_STAGE_OPTIONS, type WorkflowStageFilter } from '../utils/workflowStage';
import styles from './AppraisalCases.module.css';

interface AppraisalCasesProps {
  viewerSession: ViewerSession | null;
  onViewCase: (staffId: string) => void;
  initialCaseStatusFilter?: string;
  filterVersion?: number;
}

interface CaseListItem {
  id: string;
  staff_id: string;
  full_name: string;
  staff_role: string;
  normalized_role?: string | null;
  company?: string | null;
  contact_type: string;
  status: string;
  canonical_workflow_stage?: WorkflowStageFilter;
  wsll_gate_status?: 'PASS' | 'MISSING_WSLL' | 'WSLL_BELOW_THRESHOLD' | null;
  wsll_status_label?: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'OVERRIDE_REQUIRED' | null;
  rm_override_status?: 'NOT_REQUIRED' | 'REQUESTED' | 'APPROVED' | null;
  wsll_blocker_message?: string | null;
  wsll_average?: number | null;
  tenure?: string | null;
  last_action_timestamp?: string | null;
  final_new_base: number | null;
  proposed_increase_amount: number | null;
}

const getWsllStatusDisplay = (item: CaseListItem) => {
  if (item.wsll_status_label === 'ELIGIBLE' || item.wsll_gate_status === 'PASS') {
    return {
      label: 'Eligible',
      badgeClass: styles.wsllEligible
    };
  }

  if (item.wsll_status_label === 'OVERRIDE_REQUIRED') {
    return {
      label: 'Override Required',
      badgeClass: styles.wsllMissing
    };
  }

  if (item.wsll_gate_status === 'WSLL_BELOW_THRESHOLD') {
    return {
      label: 'Not Eligible',
      badgeClass: styles.wsllNotEligible
    };
  }

  return {
    label: 'WSLL Missing',
    badgeClass: styles.wsllMissing
  };
};

const getStatusBadgeClass = (workflowStage: WorkflowStageFilter) => {

  switch (workflowStage) {
    case 'DRAFT':
      return styles.statusDraft;
    case 'RM_OVERRIDE_NEEDED':
      return styles.statusOverrideNeeded;
    case 'READY_FOR_RECOMMENDATION':
      return styles.statusReadyForRecommendation;
    case 'AWAITING_RM_REVIEW':
      return styles.statusAwaitingReview;
    case 'REJECTED':
      return styles.statusRejected;
    case 'APPROVED':
    case 'PAYROLL_SUBMITTED':
      return styles.statusApproved;
    case 'CLIENT_APPROVAL_NEEDED':
      return styles.statusClientApproval;
    default:
      return styles.statusNeutral;
  }
};

export function AppraisalCases({
  viewerSession,
  onViewCase,
  initialCaseStatusFilter = 'ALL',
  filterVersion = 0
}: AppraisalCasesProps) {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phpToAudRate = useMemo(() => getPhpToAudRate(), []);
  const [normalizedRoleFilter, setNormalizedRoleFilter] = useState('ALL');
  const [normalizedRoleOptions, setNormalizedRoleOptions] = useState<string[]>(['ALL']);
  const [wsllFilter, setWsllFilter] = useState('ALL');
  const [caseStatusFilter, setCaseStatusFilter] = useState<WorkflowStageFilter>((initialCaseStatusFilter as WorkflowStageFilter) || 'ALL');
  const [companyFilter, setCompanyFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const viewerRole = useMemo(() => {
    if (!viewerSession) {
      return '';
    }

    return viewerSession.role === 'Admin' ? 'ADMIN' : viewerSession.role;
  }, [viewerSession]);

  useEffect(() => {
    setCaseStatusFilter((initialCaseStatusFilter as WorkflowStageFilter) || 'ALL');
    setPage(1);
  }, [initialCaseStatusFilter, filterVersion]);

  useEffect(() => {
    const loadRoleOptions = async () => {
      if (!viewerSession || !viewerRole) {
        setNormalizedRoleOptions(['ALL']);
        return;
      }

      try {
        const params = new URLSearchParams({
          viewerRole
        });

        if (viewerRole !== 'ADMIN') {
          params.set('viewerName', viewerSession.viewer_name);
          params.set('viewerEmail', viewerSession.viewer_email);
        }

        const response = await fetch(`http://localhost:3001/cases/filters/normalized-roles?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setNormalizedRoleOptions(['ALL']);
          return;
        }

        const options = Array.isArray(payload?.data?.options) ? payload.data.options.map((item: unknown) => String(item)) : ['ALL'];
        setNormalizedRoleOptions(options.length > 0 ? options : ['ALL']);
      } catch {
        setNormalizedRoleOptions(['ALL']);
      }
    };

    void loadRoleOptions();
  }, [viewerRole, viewerSession]);

  useEffect(() => {
    const loadCases = async () => {
      if (!viewerSession || !viewerRole) {
        setCases([]);
        setTotal(0);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          viewerRole,
          page: String(page),
          pageSize: String(pageSize)
        });

        if (normalizedRoleFilter !== 'ALL') {
          params.set('normalizedRole', normalizedRoleFilter);
        }

        if (companyFilter.trim()) {
          params.set('company', companyFilter.trim());
        }

        if (wsllFilter !== 'ALL') {
          params.set('wsllStatus', wsllFilter);
        }

        if (caseStatusFilter !== 'ALL') {
          params.set('workflowStage', caseStatusFilter);
        }

        if (viewerRole !== 'ADMIN') {
          params.set('viewerName', viewerSession.viewer_name);
          params.set('viewerEmail', viewerSession.viewer_email);
        }

        const response = await fetch(`http://localhost:3001/cases?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setCases([]);
          setTotal(0);
          setError(payload?.error?.message || 'Failed to load cases');
          return;
        }

        setCases(Array.isArray(payload?.data?.items) ? payload.data.items as CaseListItem[] : []);
        setTotal(Number(payload?.data?.total || 0));
      } catch {
        setCases([]);
        setTotal(0);
        setError('Failed to load cases');
      } finally {
        setLoading(false);
      }
    };

    void loadCases();
  }, [
    caseStatusFilter,
    companyFilter,
    normalizedRoleFilter,
    page,
    pageSize,
    viewerRole,
    viewerSession,
    wsllFilter
  ]);

  const pageSizeOptions = useMemo(() => [50, 100, 200], []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);
  const visibleFrom = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const visibleTo = total === 0 ? 0 : Math.min(total, page * pageSize);

  const clearFilters = () => {
    setNormalizedRoleFilter('ALL');
    setWsllFilter('ALL');
    setCaseStatusFilter('ALL');
    setCompanyFilter('');
    setPage(1);
  };

  const toggleRow = (caseId: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [caseId]: !prev[caseId]
    }));
  };

  if (!viewerSession) {
    return (
      <div className={styles.emptyStateContainer}>
        <div className={styles.innerContainer}>
          <h1 className={styles.title}>Appraisal Cases</h1>
          <p className={styles.subtitleWithMargin}>View and manage appraisal cases for employees in your scope</p>
          <div className={styles.emptyState}>
            <p className={styles.emptyStateText}>Please log in to view your appraisal cases</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        <div className={styles.header}>
          <h1 className={styles.title}>Appraisal Cases</h1>
          <p className={styles.subtitle}>View and manage appraisal cases for employees in your scope</p>
        </div>

        <div className={styles.viewerSummary}>
          <p className={styles.viewerSummaryText}>
            <strong>{viewerSession.viewer_name}</strong> ({viewerSession.role})
            {' • '}
            Showing {visibleFrom}-{visibleTo} of {total} persisted cases
          </p>
        </div>

        <div className={styles.filterBar}>
          <select
            title="Filter by normalized role"
            aria-label="Filter by normalized role"
            value={normalizedRoleFilter}
            onChange={(e) => {
              setNormalizedRoleFilter(e.target.value);
              setPage(1);
            }}
            className={styles.filterSelect}
          >
            {normalizedRoleOptions.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {roleOption === 'ALL' ? 'Normalized Role: All' : roleOption}
              </option>
            ))}
          </select>
          <select
            title="Filter by WSLL status"
            aria-label="Filter by WSLL status"
            value={wsllFilter}
            onChange={(e) => {
              setWsllFilter(e.target.value);
              setPage(1);
            }}
            className={styles.filterSelect}
          >
            <option value="ALL">WSLL: All</option>
            <option value="ELIGIBLE">Eligible</option>
            <option value="NOT_ELIGIBLE">Not Eligible</option>
            <option value="OVERRIDE_REQUIRED">Override Required (No WSLL)</option>
          </select>
          <select
            title="Filter by case status"
            aria-label="Filter by case status"
            value={caseStatusFilter}
            onChange={(e) => {
              setCaseStatusFilter(e.target.value as WorkflowStageFilter);
              setPage(1);
            }}
            className={styles.filterSelect}
          >
            {WORKFLOW_STAGE_OPTIONS.map((status) => <option key={status} value={status}>{getWorkflowStageLabel(status)}</option>)}
          </select>
          <input
            title="Filter by company"
            aria-label="Filter by company"
            value={companyFilter}
            onChange={(e) => {
              setCompanyFilter(e.target.value);
              setPage(1);
            }}
            className={styles.filterInput}
            placeholder="Company contains..."
          />
          <button type="button" className={styles.clearFiltersButton} onClick={clearFilters}>Clear Filters</button>
        </div>

        <div className={styles.tableWrapper}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th className={styles.tableHeaderCellArrow} />
                  <th className={styles.tableHeaderCell}>Staff ID</th>
                  <th className={styles.tableHeaderCell}>Employee Name</th>
                  <th className={styles.tableHeaderCell}>Normalized Role</th>
                  <th className={styles.tableHeaderCellCenter}>WSLL Status</th>
                  <th className={styles.tableHeaderCellRight}>Proposed Adj</th>
                  <th className={styles.tableHeaderCellRight}>New Comp</th>
                  <th className={styles.tableHeaderCellCenter}>Workflow Status</th>
                  <th className={styles.tableHeaderCellCenter}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>Loading cases...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>{error}</td>
                  </tr>
                ) : cases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>No cases match the selected filters</td>
                  </tr>
                ) : (
                  cases.map((caseItem, idx) => {
                    const wsllStatus = getWsllStatusDisplay(caseItem);
                    const workflowStage = caseItem.canonical_workflow_stage || getWorkflowStageFromStatus(caseItem.status);
                    const rowExpanded = Boolean(expandedRows[caseItem.id]);

                    return (
                      <Fragment key={caseItem.id}>
                        <tr
                          className={`${styles.tableRow} ${idx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd} ${idx < cases.length - 1 ? styles.tableRowNotLast : ''}`}
                          onClick={() => toggleRow(caseItem.id)}
                        >
                          <td className={styles.cellArrow}>
                            <button
                              type="button"
                              className={styles.expandButton}
                              aria-label={rowExpanded ? `Collapse ${caseItem.full_name}` : `Expand ${caseItem.full_name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRow(caseItem.id);
                              }}
                            >
                              {rowExpanded ? '▼' : '▶'}
                            </button>
                          </td>
                          <td className={styles.cellDefault}>
                            <code className={styles.cellCode}>{caseItem.staff_id}</code>
                          </td>
                          <td className={styles.cellDefault}>{caseItem.full_name}</td>
                          <td className={styles.cellDefault}>{caseItem.normalized_role || '—'}</td>
                          <td className={styles.cellCenter}>
                            <span className={`${styles.wsllBadge} ${wsllStatus.badgeClass}`}>{wsllStatus.label}</span>
                            {caseItem.wsll_gate_status !== 'PASS' ? (
                              <div className={styles.wsllReason}>{caseItem.wsll_blocker_message || 'Recommendation unavailable until WSLL is eligible.'}</div>
                            ) : null}
                          </td>
                          <td className={styles.cellRight}>{formatCompensation(caseItem.proposed_increase_amount, { view: 'appraisal-cases', caseStatus: caseItem.status, conversionRate: phpToAudRate })}</td>
                          <td className={styles.cellRight}>{formatCompensation(caseItem.final_new_base, { view: 'appraisal-cases', caseStatus: caseItem.status, conversionRate: phpToAudRate })}</td>
                          <td className={styles.cellCenter}>
                            <span className={`${styles.statusBadge} ${getStatusBadgeClass(workflowStage)}`}>{getWorkflowStageLabel(workflowStage)}</span>
                          </td>
                          <td className={styles.cellCenter}>
                            <button
                              className={styles.actionButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                onViewCase(caseItem.staff_id);
                              }}
                            >
                              View Case
                            </button>
                          </td>
                        </tr>
                        {rowExpanded ? (
                          <tr className={styles.expandedRow}>
                            <td colSpan={9} className={styles.expandedCell}>
                              <div className={styles.expandedGrid}>
                                <div>
                                  <span className={styles.expandedLabel}>Company</span>
                                  <strong>{caseItem.company || '—'}</strong>
                                </div>
                                <div>
                                  <span className={styles.expandedLabel}>Contact Type</span>
                                  <strong>{caseItem.contact_type || '—'}</strong>
                                </div>
                                <div>
                                  <span className={styles.expandedLabel}>Original Role Title</span>
                                  <strong>{caseItem.staff_role || '—'}</strong>
                                </div>
                                <div>
                                  <span className={styles.expandedLabel}>WSLL Score</span>
                                  <strong>{typeof caseItem.wsll_average === 'number' ? caseItem.wsll_average.toFixed(2) : '—'}</strong>
                                </div>
                                <div>
                                  <span className={styles.expandedLabel}>Tenure</span>
                                  <strong>{caseItem.tenure || '—'}</strong>
                                </div>
                                <div>
                                  <span className={styles.expandedLabel}>Last Action</span>
                                  <strong>{caseItem.last_action_timestamp ? new Date(caseItem.last_action_timestamp).toLocaleString() : '—'}</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.paginationBar}>
          <div className={styles.paginationSummary}>Showing {visibleFrom}-{visibleTo} of {total} cases • Page {page} of {totalPages}</div>
          <div className={styles.paginationControls}>
            <label className={styles.pageSizeLabel}>
              Page size
              <select
                aria-label="Select page size"
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.paginationButton}
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.paginationButton}
              disabled={page >= totalPages || loading}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppraisalCases;
