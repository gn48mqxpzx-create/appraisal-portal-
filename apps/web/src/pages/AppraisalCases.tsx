import { useState } from 'react';
import { ViewerSession } from '../utils/auth';

interface Employee {
  staff_id?: string;
  staffId?: string;
  full_name?: string;
  fullName?: string;
  email?: string;
  staff_role?: string;
  staffRole?: string;
  staffStartDate?: string;
}

interface AppraisalCasesProps {
  viewerSession: ViewerSession | null;
}

export function AppraisalCases({ viewerSession }: AppraisalCasesProps) {
  if (!viewerSession) {
    return (
      <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '600', margin: '0 0 8px 0', color: '#1f2937' }}>
            Appraisal Cases
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
            View and manage appraisal cases for employees in your scope
          </p>

          <div
            style={{
              backgroundColor: '#f3f4f6',
              border: '2px dashed #d1d5db',
              borderRadius: '8px',
              padding: '60px 24px',
              textAlign: 'center',
              color: '#6b7280'
            }}
          >
            <p style={{ fontSize: '16px', margin: 0 }}>
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
      const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      if (months < 12) return `${months}mo`;
      const years = Math.floor(months / 12);
      return `${years}yr${years > 1 ? 's' : ''}`;
    } catch {
      return '—';
    }
  };

  const getStaffId = (emp: Employee): string => emp.staff_id || emp.staffId || '—';
  const getFullName = (emp: Employee): string => emp.full_name || emp.fullName || '—';
  const getEmail = (emp: Employee): string => emp.email || '—';
  const getStaffRole = (emp: Employee): string => emp.staff_role || emp.staffRole || '—';
  const getStartDate = (emp: Employee): string => {
    if (!emp.staffStartDate) return '—';
    try {
      return new Date(emp.staffStartDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  const employees = viewerSession?.viewer_type === 'RM'
    ? (viewerSession?.virtual_assistants || [])
    : (viewerSession?.virtual_assistants || []);

  return (
    <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '600', margin: '0 0 8px 0', color: '#1f2937' }}>
            Appraisal Cases
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
            View and manage appraisal cases for employees in your scope
          </p>
        </div>

        {/* Viewer Summary */}
        {viewerSession && (
        <>
        <div style={{ marginBottom: '24px', backgroundColor: '#eff6ff', padding: '16px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#1e40af' }}>
            <strong>{viewerSession.viewer_name}</strong> ({viewerSession.role})
            {' • '}
            {viewerSession.scope_summary.total_va_count} appraisals
          </p>
        </div>

        {/* Cases Table */}
        <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                    Staff ID
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                    Full Name
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                    Email
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                    Role
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                    Start Date
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                    Tenure
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                    Current Comp
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                    Proposed Adj
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>
                    New Comp
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                    Status
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>
                      No cases to display
                    </td>
                  </tr>
                ) : (
                  employees.map((emp, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: idx < employees.length - 1 ? '1px solid #f3f4f6' : 'none',
                        backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                        <code style={{ fontSize: '12px', backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '3px' }}>
                          {getStaffId(emp)}
                        </code>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                        {getFullName(emp)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: '12px' }}>
                        {getEmail(emp)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                        {getStaffRole(emp)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#6b7280', textAlign: 'center' }}>
                        {getStartDate(emp)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1f2937', textAlign: 'center', fontWeight: '500' }}>
                        {calculateTenure(emp.staffStartDate)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', textAlign: 'right' }}>
                        —
                      </td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', textAlign: 'right' }}>
                        —
                      </td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', textAlign: 'right' }}>
                        —
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: '#f3f4f6',
                            color: '#6b7280',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600'
                          }}
                        >
                          Not Started
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <button
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#3b82f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
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
