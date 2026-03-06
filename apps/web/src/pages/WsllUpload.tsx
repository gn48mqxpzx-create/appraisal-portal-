import { useState, useEffect } from 'react';
import { ViewerSession } from '../utils/auth';

interface WsllUploadProps {
  viewerSession: ViewerSession | null;
}

interface SM {
  sm_owner_id: string;
  full_name: string;
}

interface VA {
  staff_id: string;
  full_name: string;
  staff_role: string;
  staffStartDate?: string;
  q1_wsll?: number;
  q2_wsll?: number;
  q3_wsll?: number;
  q4_wsll?: number;
}

export function WsllUpload({ viewerSession }: WsllUploadProps) {
  const [selectedSmOwnerId, setSelectedSmOwnerId] = useState<string>('');
  const [availableSMs, setAvailableSMs] = useState<SM[]>([]);
  const [vas, setVas] = useState<VA[]>([]);
  const [isLoadingVAs, setIsLoadingVAs] = useState(false);

  // Initialize SM dropdown and VAs based on viewer role
  useEffect(() => {
    if (!viewerSession) return;

    if (viewerSession.role === 'SM') {
      // SM: lock to their own scope
      const smOwnerId = viewerSession.viewer_name; // use viewer name as fallback; ideally we'd have smOwnerId
      setSelectedSmOwnerId(smOwnerId);
      setAvailableSMs([{ sm_owner_id: smOwnerId, full_name: viewerSession.viewer_name }]);
      loadVAsForSM(smOwnerId);
    } else if (viewerSession.role === 'RM') {
      // RM: populate dropdown with SMs under them
      if (viewerSession.success_managers) {
        const sms = viewerSession.success_managers.map((sm: any) => ({
          sm_owner_id: sm.sm_own_owner_id || sm.hubspot_id,
          full_name: sm.full_name || sm.fullName
        }));
        setAvailableSMs(sms);
        if (sms.length > 0) {
          setSelectedSmOwnerId(sms[0].sm_owner_id);
          loadVAsForSM(sms[0].sm_owner_id);
        }
      }
    } else if (viewerSession.role === 'Admin') {
      // Admin: load all SMs from backend (placeholder logic)
      loadAllSMs();
    }
  }, [viewerSession]);

  const loadAllSMs = async () => {
    // Placeholder: in production, fetch all SMs from an endpoint
    // For now, use viewer's scope if available
    if (viewerSession?.success_managers) {
      const sms = viewerSession.success_managers.map((sm: any) => ({
        sm_owner_id: sm.sm_own_owner_id || sm.hubspot_id,
        full_name: sm.full_name || sm.fullName
      }));
      setAvailableSMs(sms);
      if (sms.length > 0) {
        setSelectedSmOwnerId(sms[0].sm_owner_id);
        loadVAsForSM(sms[0].sm_owner_id);
      }
    }
  };

  const loadVAsForSM = async (smOwnerId: string) => {
    setIsLoadingVAs(true);
    try {
      // Fetch VAs for this SM from backend
      const response = await fetch(`http://localhost:3001/directory/sm/${encodeURIComponent(smOwnerId)}`);
      if (response.ok) {
        const data = await response.json();
        const vaList = (data.virtual_assistants || []).map((va: any) => ({
          staff_id: va.staff_id,
          full_name: va.full_name,
          staff_role: va.staff_role,
          staffStartDate: va.staffStartDate,
          q1_wsll: undefined, // Placeholder: fetch from wsll_scores table
          q2_wsll: undefined,
          q3_wsll: undefined,
          q4_wsll: undefined
        }));
        setVas(vaList);
      }
    } catch (error) {
      console.error('Failed to load VAs:', error);
    } finally {
      setIsLoadingVAs(false);
    }
  };

  const handleSmChange = (smOwnerId: string) => {
    setSelectedSmOwnerId(smOwnerId);
    loadVAsForSM(smOwnerId);
  };

  const handleDownloadTemplate = () => {
    // Generate and download CSV template
    const headers = 'Staff ID,Full Name,Role,Q1 WSLL,Q2 WSLL,Q3 WSLL,Q4 WSLL\n';
    const rows = vas.map((va) => 
      `${va.staff_id},${va.full_name},${va.staff_role},,,`
    ).join('\n');
    
    const csvContent = headers + rows;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wsll_template_${selectedSmOwnerId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!viewerSession) {
    return (
      <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
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
              Please log in to access WSLL Import
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isReadOnly = !viewerSession.permissions.canEditWsll;
  const canUpload = viewerSession.permissions.canUploadWsll;

  return (
    <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '600', margin: '0 0 8px 0', color: '#1f2937' }}>
            WSLL Import
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
            {isReadOnly
              ? 'View WSLL (Worldwide Sales & Loyalty List) scores for your team'
              : 'Upload and manage WSLL (Worldwide Sales & Loyalty List) data'}
          </p>
        </div>

        {/* Read-only message for SM */}
        {isReadOnly && (
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#92400e' }}>
              ℹ️ You have view-only access to WSLL data.
            </p>
          </div>
        )}

        {/* Control Bar */}
        <div style={{ marginBottom: '24px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'end' }}>
            <div>
              <label htmlFor="successManagerSelect" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#374151' }}>
                Success Manager
              </label>
              <select
                id="successManagerSelect"
                value={selectedSmOwnerId}
                onChange={(e) => handleSmChange(e.target.value)}
                disabled={viewerSession.role === 'SM'}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: viewerSession.role === 'SM' ? '#f3f4f6' : '#fff',
                  cursor: viewerSession.role === 'SM' ? 'not-allowed' : 'pointer',
                  color: '#1f2937'
                }}
              >
                {availableSMs.map((sm) => (
                  <option key={sm.sm_owner_id} value={sm.sm_owner_id}>
                    {sm.full_name}
                  </option>
                ))}
              </select>
            </div>

            {canUpload && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleDownloadTemplate}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#fff',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Download Template
                </button>
                <button
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Upload WSLL CSV
                </button>
              </div>
            )}
          </div>
        </div>

        {/* WSLL Table */}
        <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          {isLoadingVAs ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#6b7280' }}>
              Loading WSLL data...
            </div>
          ) : vas.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: '#6b7280' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <p style={{ fontSize: '16px', margin: '0 0 8px 0', fontWeight: '500' }}>
                No WSLL data available
              </p>
              <p style={{ fontSize: '13px', margin: 0, color: '#9ca3af' }}>
                {canUpload
                  ? 'Upload a WSLL CSV file to get started'
                  : 'No WSLL data has been uploaded for this team yet'}
              </p>
            </div>
          ) : (
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
                      Role
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                      Q1 WSLL
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                      Q2 WSLL
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                      Q3 WSLL
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                      Q4 WSLL
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vas.map((va, idx) => (
                    <tr
                      key={va.staff_id}
                      style={{
                        borderBottom: idx < vas.length - 1 ? '1px solid #f3f4f6' : 'none',
                        backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb'
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                        <code style={{ fontSize: '12px', backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '3px' }}>
                          {va.staff_id}
                        </code>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1f2937' }}>
                        {va.full_name}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#6b7280' }}>
                        {va.staff_role}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {va.q1_wsll ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {va.q2_wsll ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {va.q3_wsll ?? '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {va.q4_wsll ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upload History (Placeholder) */}
        {canUpload && (
          <div style={{ marginTop: '24px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
              Import History
            </h3>
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9ca3af' }}>
              <p style={{ fontSize: '13px', margin: 0 }}>
                No import history available yet
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WsllUpload;
