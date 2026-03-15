import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, getPhpToAudRate } from '../utils/currencyDisplay';
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
  company?: string | null;
  contact_type: string;
  status: string;
  wsll_gate_status?: 'PASS' | 'MISSING_WSLL' | 'WSLL_BELOW_THRESHOLD' | null;
  wsll_status_label?: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'NO_WSLL_OVERRIDE_REQUIRED' | null;
  rm_override_status?: 'NOT_REQUIRED' | 'REQUESTED' | 'APPROVED' | null;
  wsll_blocker_message?: string | null;
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

  if (item.wsll_status_label === 'NO_WSLL_OVERRIDE_REQUIRED') {
    return {
      label: item.rm_override_status === 'APPROVED' ? 'No WSLL · RM Approved' : 'No WSLL · Override Needed',
      badgeClass: item.rm_override_status === 'APPROVED' ? styles.wsllEligible : styles.wsllMissing
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

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'DRAFT':
      return 'Draft';
    case 'AWAITING_RM_OVERRIDE_APPROVAL':
      return 'RM Override Needed';
    case 'RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION':
      return 'Ready for Recommendation';
    case 'SUBMITTED_FOR_REVIEW':
      return 'Submitted';
    case 'IN_REVIEW':
      return 'Awaiting RM Review';
    case 'REVIEW_APPROVED':
      return 'Approved';
    case 'REVIEW_REJECTED':
      return 'Rejected';
    case 'APPROVED':
      return 'Approved';
    case 'SUBMITTED':
      return 'Submitted';
    case 'PENDING_CLIENT_APPROVAL':
      return 'Client Approval Needed';
    case 'AWAITING_CLIENT_APPROVAL':
      return 'Client Approval Needed';
    case 'CLIENT_APPROVED':
      return 'Client Approved';
    case 'SUBMITTED_TO_PAYROLL':
      return 'Payroll Submitted';
    default:
      return status.replace(/_/g, ' ');
  }
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'DRAFT':
      return styles.statusDraft;
    case 'AWAITING_RM_OVERRIDE_APPROVAL':
      return styles.statusOverrideNeeded;
    case 'RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION':
      return styles.statusReadyForRecommendation;
    case 'SUBMITTED_FOR_REVIEW':
    case 'IN_REVIEW':
      return styles.statusAwaitingReview;
    case 'REVIEW_REJECTED':
      return styles.statusRejected;
    case 'REVIEW_APPROVED':
    case 'APPROVED':
    case 'CLIENT_APPROVED':
    case 'SUBMITTED_TO_PAYROLL':
      return styles.statusApproved;
    case 'AWAITING_CLIENT_APPROVAL':
    case 'PENDING_CLIENT_APPROVAL':
      return styles.statusClientApproval;
    default:
      return styles.statusNeutral;
  }
};

const CASE_STATUS_OPTIONS = [
  'ALL',
  'DRAFT',
  'AWAITING_RM_OVERRIDE_APPROVAL',
  'RM_OVERRIDE_APPROVED_PENDING_RECOMMENDATION',
  'SUBMITTED_FOR_REVIEW',
  'IN_REVIEW',
  'REVIEW_REJECTED',
  'AWAITING_CLIENT_APPROVAL',
  'PENDING_CLIENT_APPROVAL',
  'REVIEW_APPROVED',
  'APPROVED',
  'CLIENT_APPROVED',
  'SUBMITTED_TO_PAYROLL'
];

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
  const [roleFilter, setRoleFilter] = useState('');
  const [wsllFilter, setWsllFilter] = useState('ALL');
  const [caseStatusFilter, setCaseStatusFilter] = useState(initialCaseStatusFilter || 'ALL');
  const [companyFilter, setCompanyFilter] = useState('');
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
    setCaseStatusFilter(initialCaseStatusFilter || 'ALL');
    setPage(1);
  }, [initialCaseStatusFilter, filterVersion]);

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

        if (roleFilter.trim()) {
          params.set('staffRole', roleFilter.trim());
        }

        if (companyFilter.trim()) {
          params.set('company', companyFilter.trim());
        }

        if (wsllFilter !== 'ALL') {
          params.set('wsllStatus', wsllFilter);
        }

        if (caseStatusFilter !== 'ALL') {
          params.set('caseStatus', caseStatusFilter);
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
    page,
    pageSize,
    roleFilter,
    viewerRole,
    viewerSession,
    wsllFilter
  ]);

  const pageSizeOptions = useMemo(() => {
    const options = [50, 100, 200, pageSize].sort((a, b) => a - b);
    return Array.from(new Set(options));
  }, [pageSize]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);
  const visibleFrom = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const visibleTo = total === 0 ? 0 : Math.min(total, page * pageSize);

  const clearFilters = () => {
    setRoleFilter('');
    setWsllFilter('ALL');
    setCaseStatusFilter('ALL');
    setCompanyFilter('');
    setPage(1);
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
          <input
            title="Filter by role"
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className={styles.filterInput}
            placeholder="Role contains..."
          />
          <select title="Filter by WSLL status" aria-label="Filter by WSLL status" value={wsllFilter} onChange={(e) => setWsllFilter(e.target.value)} className={styles.filterSelect}>
            <option value="ALL">WSLL: All</option>
            <option value="ELIGIBLE">Eligible</option>
            <option value="NOT_ELIGIBLE">Not Eligible</option>
            <option value="NO_WSLL_OVERRIDE_REQUIRED">No WSLL / RM Override Required</option>
          </select>
          <select
            title="Filter by case status"
            aria-label="Filter by case status"
            value={caseStatusFilter}
            onChange={(e) => {
              setCaseStatusFilter(e.target.value);
              setPage(1);
            }}
            className={styles.filterSelect}
          >
            {CASE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status === 'ALL' ? 'Workflow: All' : getStatusLabel(status)}</option>)}
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
                  <th className={styles.tableHeaderCell}>Staff ID</th>
                  <th className={styles.tableHeaderCell}>Full Name</th>
                  <th className={styles.tableHeaderCell}>Company</th>
                  <th className={styles.tableHeaderCell}>Role</th>
                  <th className={styles.tableHeaderCell}>Contact Type</th>
                  <th className={styles.tableHeaderCellCenter}>WSLL Status</th>
                  <th className={styles.tableHeaderCellRight}>Proposed Adj</th>
                  <th className={styles.tableHeaderCellRight}>New Comp</th>
                  <th className={styles.tableHeaderCellCenter}>Status</th>
                  <th className={styles.tableHeaderCellCenter}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyRow}>Loading cases...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyRow}>{error}</td>
                  </tr>
                ) : cases.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyRow}>No cases match the selected filters</td>
                  </tr>
                ) : (
                  cases.map((caseItem, idx) => {
                    const wsllStatus = getWsllStatusDisplay(caseItem);

                    return (
                      <tr
                        key={caseItem.id}
                        className={`${styles.tableRow} ${idx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd} ${idx < cases.length - 1 ? styles.tableRowNotLast : ''}`}
                      >
                        <td className={styles.cellDefault}>
                          <code className={styles.cellCode}>{caseItem.staff_id}</code>
                        </td>
                        <td className={styles.cellDefault}>{caseItem.full_name}</td>
                        <td className={styles.cellDefault}>{caseItem.company || '—'}</td>
                        <td className={styles.cellDefault}>{caseItem.staff_role}</td>
                        <td className={styles.cellDefault}>{caseItem.contact_type}</td>
                        <td className={styles.cellCenter}>
                          <span className={`${styles.wsllBadge} ${wsllStatus.badgeClass}`}>{wsllStatus.label}</span>
                          {caseItem.wsll_gate_status !== 'PASS' ? (
                            <div className={styles.wsllReason}>{caseItem.wsll_blocker_message || 'Recommendation unavailable until WSLL is eligible.'}</div>
                          ) : null}
                        </td>
                        <td className={styles.cellRight}>{formatCompensation(caseItem.proposed_increase_amount, { view: 'appraisal-cases', caseStatus: caseItem.status, conversionRate: phpToAudRate })}</td>
                        <td className={styles.cellRight}>{formatCompensation(caseItem.final_new_base, { view: 'appraisal-cases', caseStatus: caseItem.status, conversionRate: phpToAudRate })}</td>
                        <td className={styles.cellCenter}>
                          <span className={`${styles.statusBadge} ${getStatusBadgeClass(caseItem.status)}`}>{getStatusLabel(caseItem.status)}</span>
                        </td>
                        <td className={styles.cellCenter}>
                          <button className={styles.actionButton} onClick={() => onViewCase(caseItem.staff_id)}>
                            View Case
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.paginationBar}>
          <div className={styles.paginationSummary}>Page {page} of {totalPages}</div>
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
