import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import styles from './AppraisalCases.module.css';

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
}

interface AppraisalCasesProps {
  viewerSession: ViewerSession | null;
  onViewCase: (staffId: string) => void;
}

interface CurrentCompensationRecord {
  staffId: string;
  currentCompensation: number | string;
  currency: string;
  effectiveDate: string;
}

export function AppraisalCases({ viewerSession, onViewCase }: AppraisalCasesProps) {
  const [currentCompByStaffId, setCurrentCompByStaffId] = useState<Record<string, CurrentCompensationRecord>>({});

  const employees = useMemo(() => {
    if (!viewerSession) {
      return [];
    }

    return viewerSession.virtual_assistants || [];
  }, [viewerSession]);

  useEffect(() => {
    const loadCurrentCompensation = async () => {
      if (!viewerSession || employees.length === 0) {
        setCurrentCompByStaffId({});
        return;
      }

      const staffIds = employees
        .map((emp) => (emp.staff_id || emp.staffId || '').trim())
        .filter(Boolean);

      if (staffIds.length === 0) {
        setCurrentCompByStaffId({});
        return;
      }

      try {
        const response = await fetch(`http://localhost:3001/compensation/current?staffIds=${encodeURIComponent(staffIds.join(','))}`);
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items as CurrentCompensationRecord[] : [];

        const byStaffId = items.reduce<Record<string, CurrentCompensationRecord>>((acc, item) => {
          acc[item.staffId] = item;
          return acc;
        }, {});

        setCurrentCompByStaffId(byStaffId);
      } catch {
        setCurrentCompByStaffId({});
      }
    };

    void loadCurrentCompensation();
  }, [viewerSession, employees]);

  if (!viewerSession) {
    return (
      <div className={styles.emptyStateContainer}>
        <div className={styles.innerContainer}>
          <h1 className={styles.title}>
            Appraisal Cases
          </h1>
          <p className={styles.subtitleWithMargin}>
            View and manage appraisal cases for employees in your scope
          </p>

          <div className={styles.emptyState}>
            <p className={styles.emptyStateText}>
              Please log in to view your appraisal cases
            </p>
          </div>
        </div>
      </div>
    );
  }

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

  const getStaffId = (emp: Employee): string => emp.staff_id || emp.staffId || '—';
  const getFullName = (emp: Employee): string => emp.full_name || emp.fullName || '—';
  const getEmail = (emp: Employee): string => emp.email || '—';
  const getStaffRole = (emp: Employee): string => emp.staff_role || emp.staffRole || '—';
  const getStartDate = (emp: Employee): string => {
    const startDate = emp.staff_start_date || emp.staffStartDate;
    if (!startDate) return '—';
    try {
      return new Date(startDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  const getTenure = (emp: Employee): string => {
    return calculateTenure(emp.staff_start_date || emp.staffStartDate);
  };

  const formatCurrentCompensation = (staffId: string): string => {
    const record = currentCompByStaffId[staffId];
    if (!record) {
      return '—';
    }

    const amount = Number(record.currentCompensation);
    if (Number.isNaN(amount)) {
      return '—';
    }

    const currency = record.currency || 'AUD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.innerContainer}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>
            Appraisal Cases
          </h1>
          <p className={styles.subtitle}>
            View and manage appraisal cases for employees in your scope
          </p>
        </div>

        {/* Viewer Summary */}
        {viewerSession && (
        <>
        <div className={styles.viewerSummary}>
          <p className={styles.viewerSummaryText}>
            <strong>{viewerSession.viewer_name}</strong> ({viewerSession.role})
            {' • '}
            {viewerSession.scope_summary.total_va_count} appraisals
          </p>
        </div>

        {/* Cases Table */}
        <div className={styles.tableWrapper}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th className={styles.tableHeaderCell}>
                    Staff ID
                  </th>
                  <th className={styles.tableHeaderCell}>
                    Full Name
                  </th>
                  <th className={styles.tableHeaderCell}>
                    Email
                  </th>
                  <th className={styles.tableHeaderCell}>
                    Role
                  </th>
                  <th className={styles.tableHeaderCellCenter}>
                    Start Date
                  </th>
                  <th className={styles.tableHeaderCellCenter}>
                    Tenure
                  </th>
                  <th className={styles.tableHeaderCellRight}>
                    Current Comp
                  </th>
                  <th className={styles.tableHeaderCellRight}>
                    Proposed Adj
                  </th>
                  <th className={styles.tableHeaderCellRight}>
                    New Comp
                  </th>
                  <th className={styles.tableHeaderCellCenter}>
                    Status
                  </th>
                  <th className={styles.tableHeaderCellCenter}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={11} className={styles.emptyRow}>
                      No cases to display
                    </td>
                  </tr>
                ) : (
                  employees.map((emp, idx) => (
                    <tr
                      key={idx}
                      className={`${styles.tableRow} ${idx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd} ${idx < employees.length - 1 ? styles.tableRowNotLast : ''}`}
                    >
                      <td className={styles.cellDefault}>
                        <code className={styles.cellCode}>
                          {getStaffId(emp)}
                        </code>
                      </td>
                      <td className={styles.cellDefault}>
                        {getFullName(emp)}
                      </td>
                      <td className={styles.cellEmail}>
                        {getEmail(emp)}
                      </td>
                      <td className={styles.cellDefault}>
                        {getStaffRole(emp)}
                      </td>
                      <td className={styles.cellCenter}>
                        {getStartDate(emp)}
                      </td>
                      <td className={styles.cellCenterBold}>
                        {getTenure(emp)}
                      </td>
                      <td className={styles.cellRight}>
                        {formatCurrentCompensation(getStaffId(emp))}
                      </td>
                      <td className={styles.cellRight}>
                        —
                      </td>
                      <td className={styles.cellRight}>
                        —
                      </td>
                      <td className={styles.cellCenter}>
                        <span className={styles.statusBadge}>
                          Not Started
                        </span>
                      </td>
                      <td className={styles.cellCenter}>
                        <button 
                          className={styles.actionButton}
                          onClick={() => onViewCase(getStaffId(emp))}
                        >
                          View Case
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

export default AppraisalCases;
