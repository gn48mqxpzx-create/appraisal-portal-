import { useState, useEffect } from 'react';
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

export function CaseDetailPage({ staffId, viewerSession, onNavigateBack }: CaseDetailPageProps) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notes, setNotes] = useState<string>('');

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
                <div className={styles.fieldValue}>—</div>
              </div>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>Proposed Adjustment</label>
                <div className={styles.fieldValue}>—</div>
              </div>
              <div className={styles.compensationField}>
                <label className={styles.fieldLabel}>New Compensation</label>
                <div className={styles.fieldValue}>—</div>
              </div>
            </div>
          </div>
        </div>

        {/* Case Status Section */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Case Status</h2>
          <div className={styles.cardContent}>
            <div className={styles.statusSection}>
              <div className={styles.statusField}>
                <label className={styles.fieldLabel}>Status</label>
                <div className={styles.statusBadge}>Not Started</div>
              </div>
              <div className={styles.actionButtons}>
                <button className={styles.button} disabled>
                  Start Case
                </button>
                <button className={styles.button} disabled>
                  Submit for Review
                </button>
                <button className={styles.button} disabled>
                  Approve
                </button>
                <button className={styles.button} disabled>
                  Reject
                </button>
              </div>
            </div>
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
      </div>
    </div>
  );
}

export default CaseDetailPage;
