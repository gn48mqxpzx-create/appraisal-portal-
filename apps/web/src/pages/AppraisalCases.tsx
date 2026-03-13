import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatCompensation, getPhpToAudRate } from '../utils/currencyDisplay';
import styles from './AppraisalCases.module.css';

interface AppraisalCasesProps {
  viewerSession: ViewerSession | null;
  onViewCase: (staffId: string) => void;
}

interface CaseListItem {
  id: string;
  staff_id: string;
  full_name: string;
  staff_role: string;
  contact_type: string;
  status: string;
  wsll_gate_status?: 'PASS' | 'MISSING_WSLL' | 'WSLL_BELOW_THRESHOLD' | null;
  wsll_blocker_message?: string | null;
  final_new_base: number | null;
  proposed_increase_amount: number | null;
}

const getWsllStatusDisplay = (status: CaseListItem['wsll_gate_status']) => {
  if (status === 'PASS') {
    return {
      label: 'Eligible',
      badgeClass: styles.wsllEligible
    };
  }

  if (status === 'WSLL_BELOW_THRESHOLD') {
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
    case 'SUBMITTED_FOR_REVIEW':
      return 'Submitted';
    case 'REVIEW_APPROVED':
      return 'Review Approved';
    case 'REVIEW_REJECTED':
      return 'Review Rejected';
    case 'PENDING_CLIENT_APPROVAL':
      return 'Client Approval Pending';
    case 'CLIENT_APPROVED':
      return 'Client Approved';
    case 'SUBMITTED_TO_PAYROLL':
      return 'Payroll Submitted';
    default:
      return status.replace(/_/g, ' ');
  }
};

export function AppraisalCases({ viewerSession, onViewCase }: AppraisalCasesProps) {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phpToAudRate = useMemo(() => getPhpToAudRate(), []);

  const viewerRole = useMemo(() => {
    if (!viewerSession) {
      return '';
    }

    return viewerSession.role === 'Admin' ? 'ADMIN' : viewerSession.role;
  }, [viewerSession]);

  useEffect(() => {
    const loadCases = async () => {
      if (!viewerSession || !viewerRole) {
        setCases([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          viewerRole,
          page: '1',
          pageSize: '250'
        });

        if (viewerRole !== 'ADMIN') {
          params.set('viewerName', viewerSession.viewer_name);
          params.set('viewerEmail', viewerSession.viewer_email);
        }

        const response = await fetch(`http://localhost:3001/cases?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          setCases([]);
          setError(payload?.error?.message || 'Failed to load cases');
          return;
        }

        setCases(Array.isArray(payload?.data?.items) ? payload.data.items as CaseListItem[] : []);
      } catch {
        setCases([]);
        setError('Failed to load cases');
      } finally {
        setLoading(false);
      }
    };

    void loadCases();
  }, [viewerRole, viewerSession]);

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
            {cases.length} persisted cases
          </p>
        </div>

        <div className={styles.tableWrapper}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th className={styles.tableHeaderCell}>Staff ID</th>
                  <th className={styles.tableHeaderCell}>Full Name</th>
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
                    <td colSpan={9} className={styles.emptyRow}>Loading cases...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>{error}</td>
                  </tr>
                ) : cases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>No cases to display</td>
                  </tr>
                ) : (
                  cases.map((caseItem, idx) => {
                    const wsllStatus = getWsllStatusDisplay(caseItem.wsll_gate_status);

                    return (
                      <tr
                        key={caseItem.id}
                        className={`${styles.tableRow} ${idx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd} ${idx < cases.length - 1 ? styles.tableRowNotLast : ''}`}
                      >
                        <td className={styles.cellDefault}>
                          <code className={styles.cellCode}>{caseItem.staff_id}</code>
                        </td>
                        <td className={styles.cellDefault}>{caseItem.full_name}</td>
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
                          <span className={styles.statusBadge}>{getStatusLabel(caseItem.status)}</span>
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
      </div>
    </div>
  );
}

export default AppraisalCases;
