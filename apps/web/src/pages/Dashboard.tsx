import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ViewerSession, loadViewerSession } from '../utils/auth';

interface AppraisalMetrics {
  eligible: number;
  draft: number;
  submitted: number;
  forReview: number;
  approved: number;
  rejected: number;
}

interface DashboardProps {
  viewerSession: ViewerSession | null;
}

export function Dashboard({ viewerSession }: DashboardProps) {
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

  const getMetrics = (): AppraisalMetrics => {
    if (!viewerSession) {
      return {
        eligible: 0,
        draft: 0,
        submitted: 0,
        forReview: 0,
        approved: 0,
        rejected: 0
      };
    }

    // Use real eligible count from scope
    const eligible = viewerSession.scope_summary.total_va_count;

    // Mock case statuses for now (to be replaced with real data from backend)
    const mockRatio = Math.max(0.3, Math.min(eligible, 50));
    return {
      eligible,
      draft: Math.floor(mockRatio * 0.3),
      submitted: Math.floor(mockRatio * 0.25),
      forReview: Math.floor(mockRatio * 0.2),
      approved: Math.floor(mockRatio * 0.15),
      rejected: Math.floor(mockRatio * 0.1)
    };
  };

  const metrics = getMetrics();

  const pipelineData = [
    { name: 'Draft', value: metrics.draft, fill: '#e8e8e8' },
    { name: 'Submitted', value: metrics.submitted, fill: '#b3d9ff' },
    { name: 'For Review', value: metrics.forReview, fill: '#ffb3ba' },
    { name: 'Approved', value: metrics.approved, fill: '#baf8ba' },
    { name: 'Rejected', value: metrics.rejected, fill: '#ffb3ba' }
  ];

  const getTenureBuckets = () => {
    if (!viewerSession?.virtual_assistants) return [];

    const now = new Date();
    const buckets = {
      '0-1 years': 0,
      '1-3 years': 0,
      '3-5 years': 0,
      '5+ years': 0
    };

    viewerSession.virtual_assistants.forEach((va: any) => {
      const startDate = va.staffStartDate ? new Date(va.staffStartDate) : null;
      if (!startDate || isNaN(startDate.getTime())) return;

      const yearsDiff = (now.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

      if (yearsDiff < 1) buckets['0-1 years']++;
      else if (yearsDiff < 3) buckets['1-3 years']++;
      else if (yearsDiff < 5) buckets['3-5 years']++;
      else buckets['5+ years']++;
    });

    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  };

  const rmDistributionData = (() => {
    if (viewerSession?.viewer_type === 'RM' && viewerSession?.success_managers) {
      const grouped: { [key: string]: number } = {};
      viewerSession.success_managers.forEach((sm: any) => {
        const name = sm.full_name || sm.fullName || 'Unknown';
        grouped[name] = (grouped[name] || 0) + 1;
      });
      return Object.entries(grouped).map(([name, count]) => ({
        name,
        value: count
      }));
    }
    return [];
  })();

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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
          <div style={{ marginBottom: '32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
            {[
              { label: 'Eligible for Appraisal', value: metrics.eligible, color: '#3b82f6' },
              { label: 'Draft', value: metrics.draft, color: '#9ca3af' },
              { label: 'Submitted', value: metrics.submitted, color: '#3b82f6' },
              { label: 'For Review', value: metrics.forReview, color: '#f59e0b' },
              { label: 'Approved', value: metrics.approved, color: '#10b981' },
              { label: 'Rejected', value: metrics.rejected, color: '#ef4444' }
            ].map((card) => (
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

          {/* Charts Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '16px' }}>
            {/* Appraisal Pipeline */}
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
                Appraisal Pipeline
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pipelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: '4px', border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* RM Distribution */}
            {viewerSession.viewer_type === 'RM' && rmDistributionData.length > 0 && (
              <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
                  SMs in Scope
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={rmDistributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: '4px', border: '1px solid #e5e7eb' }} />
                    <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Status Distribution */}
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
                Status Distribution
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pipelineData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pipelineData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '4px', border: '1px solid #e5e7eb' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Tenure Distribution */}
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#1f2937' }}>
                Tenure Distribution
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={getTenureBuckets()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: '4px', border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
