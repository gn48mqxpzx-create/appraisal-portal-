import { useEffect, useMemo, useState } from 'react';
import { ViewerSession } from '../utils/auth';
import { type WorkflowStageFilter } from '../utils/workflowStage';

interface AppraisalMetrics {
  workflowCounts: {
    review: number;
    rmOverrideNeeded: number;
    readyForRecommendation: number;
    awaitingRmReview: number;
    clientApprovalNeeded: number;
    rejected: number;
    approved: number;
  };
  coverage: {
    totalVas: number;
    eligible: number;
    notEligible: number;
    overrideRequired: number;
  };
  totalVas: number;
}

interface DashboardProps {
  viewerSession: ViewerSession | null;
  onNavigate: (destination: 'cases' | 'review-queue', caseStatusFilter?: WorkflowStageFilter) => void;
}

export function Dashboard({ viewerSession, onNavigate }: DashboardProps) {
  const [metrics, setMetrics] = useState<AppraisalMetrics>({
    workflowCounts: {
      review: 0,
      rmOverrideNeeded: 0,
      readyForRecommendation: 0,
      awaitingRmReview: 0,
      clientApprovalNeeded: 0,
      rejected: 0,
      approved: 0
    },
    coverage: {
      totalVas: 0,
      eligible: 0,
      notEligible: 0,
      overrideRequired: 0
    },
    totalVas: 0
  });
  const [loadingMetrics, setLoadingMetrics] = useState(false);

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
              Please log in to access your dashboard
            </p>
          </div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const loadDashboardSummary = async () => {
      if (!viewerSession) {
        return;
      }

      setLoadingMetrics(true);
      try {
        const viewerRole = viewerSession.role === 'Admin' ? 'ADMIN' : viewerSession.role;
        const params = new URLSearchParams({
          viewerRole
        });

        if (viewerRole !== 'ADMIN') {
          params.set('viewerName', viewerSession.viewer_name);
          params.set('viewerEmail', viewerSession.viewer_email);
        }

        const response = await fetch(`http://localhost:3001/dashboard/summary?${params.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMetrics({
            workflowCounts: {
              review: 0,
              rmOverrideNeeded: 0,
              readyForRecommendation: 0,
              awaitingRmReview: 0,
              clientApprovalNeeded: 0,
              rejected: 0,
              approved: 0
            },
            coverage: {
              totalVas: 0,
              eligible: 0,
              notEligible: 0,
              overrideRequired: 0
            },
            totalVas: 0
          });
          return;
        }

        const apiData = payload?.data || {};
        const workflowCounts = apiData.workflowCounts || {};
        const coverage = apiData.coverage || {};

        setMetrics({
          workflowCounts: {
            review: Number(workflowCounts.review || apiData.forReview || 0),
            rmOverrideNeeded: Number(workflowCounts.rmOverrideNeeded || 0),
            readyForRecommendation: Number(workflowCounts.readyForRecommendation || 0),
            awaitingRmReview: Number(workflowCounts.awaitingRmReview || 0),
            clientApprovalNeeded: Number(workflowCounts.clientApprovalNeeded || 0),
            rejected: Number(workflowCounts.rejected || apiData.rejected || 0),
            approved: Number(workflowCounts.approved || apiData.approved || 0)
          },
          coverage: {
            totalVas: Number(coverage.totalVas || apiData.totalVas || 0),
            eligible: Number(coverage.eligible || apiData.wsllEligibleVas || 0),
            notEligible: Number(coverage.notEligible || apiData.wsllNotEligibleVas || 0),
            overrideRequired: Number(coverage.overrideRequired || apiData.overrideRequiredNoWsll || 0)
          },
          totalVas: Number(apiData.totalVas || coverage.totalVas || 0)
        });
      } catch {
        setMetrics({
          workflowCounts: {
            review: 0,
            rmOverrideNeeded: 0,
            readyForRecommendation: 0,
            awaitingRmReview: 0,
            clientApprovalNeeded: 0,
            rejected: 0,
            approved: 0
          },
          coverage: {
            totalVas: 0,
            eligible: 0,
            notEligible: 0,
            overrideRequired: 0
          },
          totalVas: 0
        });
      } finally {
        setLoadingMetrics(false);
      }
    };

    void loadDashboardSummary();
  }, [viewerSession]);

  const summaryCards = useMemo(() => {
    const isSm = viewerSession?.role === 'SM';

    if (isSm) {
      return [
        { label: 'RM Override Needed', value: metrics.workflowCounts.rmOverrideNeeded, color: '#9a3412', onClick: () => onNavigate('cases', 'RM_OVERRIDE_NEEDED' as WorkflowStageFilter) },
        { label: 'Ready for Recommendation', value: metrics.workflowCounts.readyForRecommendation, color: '#1d4ed8', onClick: () => onNavigate('cases', 'READY_FOR_RECOMMENDATION' as WorkflowStageFilter) },
        { label: 'Awaiting RM Review', value: metrics.workflowCounts.awaitingRmReview, color: '#92400e', onClick: () => onNavigate('cases', 'AWAITING_RM_REVIEW' as WorkflowStageFilter) },
        { label: 'Client Approval Needed', value: metrics.workflowCounts.clientApprovalNeeded, color: '#155e75', onClick: () => onNavigate('cases', 'CLIENT_APPROVAL_NEEDED' as WorkflowStageFilter) },
        { label: 'Rejected', value: metrics.workflowCounts.rejected, color: '#dc2626', onClick: () => onNavigate('cases', 'REJECTED' as WorkflowStageFilter) },
        { label: 'Total VAs', value: metrics.totalVas, color: '#374151', onClick: () => onNavigate('cases', 'ALL') }
      ];
    }

    return [
      { label: 'Review', value: metrics.workflowCounts.review, color: '#f59e0b', onClick: () => onNavigate('review-queue') },
      { label: 'Ready for Recommendation', value: metrics.workflowCounts.readyForRecommendation, color: '#1d4ed8', onClick: () => onNavigate('cases', 'READY_FOR_RECOMMENDATION' as WorkflowStageFilter) },
      { label: 'Awaiting RM Review', value: metrics.workflowCounts.awaitingRmReview, color: '#92400e', onClick: () => onNavigate('cases', 'AWAITING_RM_REVIEW' as WorkflowStageFilter) },
      { label: 'Client Approval Needed', value: metrics.workflowCounts.clientApprovalNeeded, color: '#155e75', onClick: () => onNavigate('cases', 'CLIENT_APPROVAL_NEEDED' as WorkflowStageFilter) },
      { label: 'Rejected', value: metrics.workflowCounts.rejected, color: '#dc2626', onClick: () => onNavigate('cases', 'REJECTED' as WorkflowStageFilter) },
      { label: 'Approved', value: metrics.workflowCounts.approved, color: '#16a34a', onClick: () => onNavigate('cases', 'APPROVED' as WorkflowStageFilter) }
    ];
  }, [metrics, onNavigate, viewerSession?.role]);

  const operationalCards = useMemo(
    () => [
      { label: 'Total VAs', value: metrics.coverage.totalVas, color: '#374151' },
      { label: 'Eligible', value: metrics.coverage.eligible, color: '#166534' },
      { label: 'Not Eligible', value: metrics.coverage.notEligible, color: '#9a3412' },
      { label: 'Override Required', value: metrics.coverage.overrideRequired, color: '#b45309' }
    ],
    [metrics.coverage]
  );

  return (
    <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

        {/* Viewer Header Card */}
        {viewerSession && (
          <div style={{ marginBottom: '32px', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase' }}>
                Logged in as
              </span>
              <p style={{ fontSize: '18px', fontWeight: '600', margin: '4px 0 0 0', color: '#1f2937' }}>
                {viewerSession.viewer_name}
              </p>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase' }}>
                Role
              </span>
              <p style={{ fontSize: '18px', fontWeight: '600', margin: '4px 0 0 0', color: '#1f2937' }}>
                {viewerSession.role}
              </p>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase' }}>
                Scope
              </span>
              <p style={{ fontSize: '18px', fontWeight: '600', margin: '4px 0 0 0', color: '#1f2937' }}>
                {viewerSession.viewer_type === 'SM'
                  ? `${viewerSession.scope_summary.total_va_count} VAs`
                  : `${viewerSession.scope_summary.total_sm_count} SMs • ${viewerSession.scope_summary.total_va_count} VAs`}
              </p>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {viewerSession && (
        <>
          {loadingMetrics ? <p style={{ marginBottom: '12px', fontSize: '12px', color: '#6b7280' }}>Loading live workflow data...</p> : null}

          <h2 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Workflow Status</h2>
          <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px' }}>
            {summaryCards.map((card) => (
              <div
                key={card.label}
                role="button"
                tabIndex={0}
                onClick={card.onClick}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    (event.currentTarget as HTMLDivElement).click();
                  }
                }}
                style={{
                  backgroundColor: '#fff',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '28px', fontWeight: '700', color: card.color, marginBottom: '4px' }}>
                  {card.value}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>
                  {card.label}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.02em' }}>VA Coverage</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
            {operationalCards.map((card) => (
              <div
                key={card.label}
                style={{
                  backgroundColor: '#fff',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '28px', fontWeight: '700', color: card.color, marginBottom: '4px' }}>
                  {card.value}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>
                  {card.label}
                </div>
              </div>
            ))}
          </div>
        </>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
