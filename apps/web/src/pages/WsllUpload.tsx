import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { ViewerSession } from '../utils/auth';
import { formatWsll } from '../utils/currencyDisplay';

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

interface WsllImportHistoryEntry {
  id: string;
  fileName: string;
  imported: number;
  flagged: number;
  totalRows: number;
  smOwnerId: string;
  uploadedAt: string;
}

interface WsllTableResponse {
  success: boolean;
  data?: {
    total_va_count?: number;
    wsll_row_count?: number;
    rows: VA[];
  };
}

interface WsllHistoryResponse {
  success: boolean;
  data?: {
    entries: WsllImportHistoryEntry[];
  };
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function WsllUpload({ viewerSession }: WsllUploadProps) {
  const [selectedSmOwnerId, setSelectedSmOwnerId] = useState<string>('');
  const [availableSMs, setAvailableSMs] = useState<SM[]>([]);
  const [vas, setVas] = useState<VA[]>([]);
  const [isLoadingVAs, setIsLoadingVAs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<WsllImportHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [scopedTotalVaCount, setScopedTotalVaCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize SM dropdown and VAs based on viewer role
  useEffect(() => {
    if (!viewerSession) return;

    if (viewerSession.role === 'SM') {
      // SM: always load full viewer scope
      setSelectedSmOwnerId('');
      setAvailableSMs([]);
      void loadScopedVAs();
    } else if (viewerSession.role === 'RM') {
      // RM: always load full viewer scope (all VAs under their SM tree)
      setSelectedSmOwnerId('');
      setAvailableSMs([]);
      void loadScopedVAs();
    } else if (viewerSession.role === 'Admin') {
      // Admin: load all SMs from backend (placeholder logic)
      loadAllSMs();
    }
  }, [viewerSession]);

  const loadScopedVAs = async () => {
    if (!viewerSession) {
      setVas([]);
      setScopedTotalVaCount(0);
      return;
    }

    setIsLoadingVAs(true);
    try {
      const params = new URLSearchParams();
      params.set('viewerRole', viewerSession.role === 'Admin' ? 'ADMIN' : viewerSession.role);
      params.set('viewerName', viewerSession.viewer_name);
      params.set('viewerEmail', viewerSession.viewer_email);

      const response = await fetch(`${API_BASE}/wsll/table?${params.toString()}`);
      if (!response.ok) {
        setVas([]);
        setScopedTotalVaCount(0);
        return;
      }

      const payload = (await response.json().catch(() => null)) as WsllTableResponse | null;
      if (!payload?.success) {
        setVas([]);
        setScopedTotalVaCount(0);
        return;
      }

      const vaList = (payload.data?.rows || []).map((va: any) => ({
        staff_id: va.staff_id,
        full_name: va.full_name,
        staff_role: va.staff_role,
        staffStartDate: va.staff_start_date ?? va.staffStartDate,
        q1_wsll: typeof va.q1_wsll === 'number' ? va.q1_wsll : undefined,
        q2_wsll: typeof va.q2_wsll === 'number' ? va.q2_wsll : undefined,
        q3_wsll: typeof va.q3_wsll === 'number' ? va.q3_wsll : undefined,
        q4_wsll: typeof va.q4_wsll === 'number' ? va.q4_wsll : undefined
      }));

      setScopedTotalVaCount(Number(payload.data?.total_va_count || 0));
      setVas(vaList);
    } catch (error) {
      console.error('Failed to load scoped WSLL table:', error);
      setVas([]);
      setScopedTotalVaCount(0);
    } finally {
      setIsLoadingVAs(false);
    }
  };

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
        void refreshScopeData(sms[0].sm_owner_id);
      }
    }
  };

  const loadImportHistoryForSM = async (smOwnerId: string) => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`${API_BASE}/wsll/import-history/sm/${encodeURIComponent(smOwnerId)}`);
      const payload = (await response.json().catch(() => null)) as WsllHistoryResponse | null;

      if (!response.ok || !payload?.success) {
        setImportHistory([]);
        return;
      }

      setImportHistory(payload.data?.entries ?? []);
    } catch (error) {
      console.error('Failed to load WSLL import history:', error);
      setImportHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadVAsForSM = async (smOwnerId: string) => {
    setIsLoadingVAs(true);
    try {
      const response = await fetch(`${API_BASE}/wsll/table/sm/${encodeURIComponent(smOwnerId)}`);
      if (response.ok) {
        const data = (await response.json().catch(() => null)) as WsllTableResponse | null;
        const vaList = (data?.data?.rows || []).map((va: any) => ({
          staff_id: va.staff_id,
          full_name: va.full_name,
          staff_role: va.staff_role,
          staffStartDate: va.staff_start_date ?? va.staffStartDate,
          q1_wsll: typeof va.q1_wsll === 'number' ? va.q1_wsll : undefined,
          q2_wsll: typeof va.q2_wsll === 'number' ? va.q2_wsll : undefined,
          q3_wsll: typeof va.q3_wsll === 'number' ? va.q3_wsll : undefined,
          q4_wsll: typeof va.q4_wsll === 'number' ? va.q4_wsll : undefined
        }));
        setScopedTotalVaCount(vaList.length);
        setVas(vaList);
        return;
      }

      setScopedTotalVaCount(0);
      setVas([]);
    } catch (error) {
      console.error('Failed to load VAs:', error);
      setScopedTotalVaCount(0);
      setVas([]);
    } finally {
      setIsLoadingVAs(false);
    }
  };

  const refreshScopeData = async (smOwnerId: string) => {
    await Promise.all([
      loadVAsForSM(smOwnerId),
      loadImportHistoryForSM(smOwnerId)
    ]);
  };

  const handleSmChange = (smOwnerId: string) => {
    setSelectedSmOwnerId(smOwnerId);
    void refreshScopeData(smOwnerId);
  };

  const handleUploadButtonClick = () => {
    console.log('[WSLL Upload] button click fired');
    if (!fileInputRef.current) {
      console.error('[WSLL Upload] file input ref is missing');
      setUploadError('Upload control is unavailable. Please refresh the page and try again.');
      return;
    }

    console.log('[WSLL Upload] opening file picker');
    fileInputRef.current.click();
  };

  const handleUploadFile = async (file: File) => {
    if (!selectedSmOwnerId) {
      setUploadError('Select a Success Manager before uploading.');
      return;
    }

    console.log('[WSLL Upload] upload started', {
      fileName: file.name,
      selectedSmOwnerId,
      size: file.size
    });

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploaded_by', viewerSession?.viewer_email || viewerSession?.viewer_name || 'wsll-ui-upload');

      const response = await fetch(`${API_BASE}/wsll/upload`, {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        const message = payload?.error?.message || 'Failed to upload WSLL CSV';
        console.error('[WSLL Upload] upload error', message);
        setUploadError(message);
        return;
      }

      const imported = Number(payload?.data?.imported || 0);
      const flagged = Number(payload?.data?.flagged || 0);
      const totalRows = Number(payload?.data?.total_rows || 0);

      console.log('[WSLL Upload] upload success', {
        imported,
        flagged,
        totalRows
      });

      setUploadSuccess(`Upload complete: ${imported} imported, ${flagged} flagged (of ${totalRows} rows).`);

      await refreshScopeData(selectedSmOwnerId);
    } catch (error) {
      console.error('[WSLL Upload] upload failed', error);
      setUploadError('Failed to upload WSLL CSV. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    console.log('[WSLL Upload] file selected', {
      name: file.name,
      type: file.type
    });

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Please select a CSV file.');
      event.target.value = '';
      return;
    }

    await handleUploadFile(file);
    event.target.value = '';
  };

  const handleDownloadTemplate = () => {
    // Generate and download CSV template
    const headers = 'Staff ID,Full Name,Q1 WSLL,Q2 WSLL,Q3 WSLL,Q4 WSLL\n';
    const rows = vas.map((va) => 
      `${va.staff_id},${va.full_name},,,,`
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

        {uploadError && (
          <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#991b1b' }}>{uploadError}</p>
          </div>
        )}

        {uploadSuccess && (
          <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#166534' }}>{uploadSuccess}</p>
          </div>
        )}

        {/* Control Bar */}
        <div style={{ marginBottom: '24px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: canUpload ? '1fr auto' : '1fr', gap: '16px', alignItems: 'end' }}>
            <div>
              {canUpload ? (
                <>
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
                </>
              ) : (
                <>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#374151' }}>
                    Scope
                  </label>
                  <div style={{ padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', backgroundColor: '#f9fafb', color: '#374151' }}>
                    Your team ({scopedTotalVaCount} VAs)
                  </div>
                </>
              )}
            </div>

            {canUpload && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
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
                  type="button"
                  onClick={handleUploadButtonClick}
                  disabled={isUploading || !selectedSmOwnerId}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: isUploading || !selectedSmOwnerId ? '#93c5fd' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isUploading || !selectedSmOwnerId ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isUploading ? 'Uploading...' : 'Upload WSLL CSV'}
                </button>
                <input
                  ref={fileInputRef}
                  id="wsll-upload-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Upload WSLL CSV file"
                  title="Upload WSLL CSV file"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />
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
                  : scopedTotalVaCount > 0
                    ? 'No WSLL data has been uploaded for your team yet.'
                    : 'No VAs are currently in your scope.'}
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
                        {formatWsll(va.q1_wsll)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {formatWsll(va.q2_wsll)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {formatWsll(va.q3_wsll)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6b7280' }}>
                        {formatWsll(va.q4_wsll)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upload History */}
        {canUpload && (
          <div style={{ marginTop: '24px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
              Import History
            </h3>
            {isLoadingHistory ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <p style={{ fontSize: '13px', margin: 0 }}>
                  Loading import history...
                </p>
              </div>
            ) : importHistory.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9ca3af' }}>
                <p style={{ fontSize: '13px', margin: 0 }}>
                  No import history available yet
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {importHistory.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      backgroundColor: '#f9fafb'
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937', marginBottom: '4px' }}>{entry.fileName}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Imported {entry.imported} / {entry.totalRows}, Flagged {entry.flagged} • SM {entry.smOwnerId} • {new Date(entry.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default WsllUpload;
