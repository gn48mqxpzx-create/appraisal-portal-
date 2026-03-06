import { useState } from 'react';
import { Permissions, ViewerSession, canAccessPage } from '../../utils/auth';

interface SideNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  viewerSession: ViewerSession | null;
  onLogout: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function SideNav({ currentPage, onNavigate, viewerSession, onLogout, sidebarCollapsed, onToggleSidebar }: SideNavProps) {
  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'cases', label: 'Appraisal Cases', icon: '📋' },
    { id: 'wsll', label: 'WSLL Import', icon: '📁' },
    { id: 'payroll', label: 'Payroll Export', icon: '💰' },
    { id: 'admin', label: 'Admin Console', icon: '⚙️' }
  ];

  // Filter navItems based on permissions
  const navItems = viewerSession
    ? allNavItems.filter((item) => canAccessPage(viewerSession.permissions, item.id))
    : [];

  return (
    <div
      style={{
        width: sidebarCollapsed ? '80px' : '280px',
        backgroundColor: '#fff',
        borderRight: '1px solid #e5e7eb',
        padding: '24px 0',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        overflowY: 'auto',
        transition: 'width 0.3s ease'
      }}
    >
      {/* Toggle Button */}
      <div style={{ padding: sidebarCollapsed ? '0 12px' : '0 24px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {!sidebarCollapsed && (
          <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0, color: '#1f2937' }}>
            Appraisal Portal
          </h2>
        )}
        <button
          onClick={onToggleSidebar}
          style={{
            padding: '6px 8px',
            backgroundColor: 'transparent',
            border: '1px solid #e5e7eb',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? '→' : '←'}
        </button>
      </div>

      {!sidebarCollapsed && (
        <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 32px 0', padding: '0 24px' }}>
          v1.0
        </p>
      )}

      {/* User info */}
      {viewerSession && (
        <div style={{ padding: sidebarCollapsed ? '12px 12px' : '12px 24px', marginBottom: '16px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
          {!sidebarCollapsed && (
            <>
              <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase' }}>
                Logged in as
              </div>
              <div style={{ fontSize: '13px', color: '#1f2937', fontWeight: '600', marginTop: '4px' }}>
                {viewerSession.viewer_name}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                {viewerSession.role}
              </div>
            </>
          )}
          {sidebarCollapsed && (
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', textAlign: 'center' }} title={`${viewerSession.viewer_name} (${viewerSession.role})`}>
              👤
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1 }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              gap: sidebarCollapsed ? '0' : '12px',
              padding: sidebarCollapsed ? '12px' : '12px 24px',
              backgroundColor: currentPage === item.id ? '#eff6ff' : 'transparent',
              color: currentPage === item.id ? '#1e40af' : '#6b7280',
              border: 'none',
              borderLeft: sidebarCollapsed ? 'none' : (currentPage === item.id ? '4px solid #3b82f6' : '4px solid transparent'),
              borderTop: sidebarCollapsed && currentPage === item.id ? '2px solid #3b82f6' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: currentPage === item.id ? '600' : '400',
              transition: 'all 0.2s',
              textAlign: 'left'
            }}
            onMouseOver={(e) => {
              if (currentPage !== item.id) {
                (e.target as HTMLElement).style.backgroundColor = '#f9fafb';
              }
            }}
            onMouseOut={(e) => {
              if (currentPage !== item.id) {
                (e.target as HTMLElement).style.backgroundColor = 'transparent';
              }
            }}
            title={sidebarCollapsed ? item.label : undefined}
          >
            <span style={{ fontSize: '18px' }}>{item.icon}</span>
            {!sidebarCollapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Footer with Logout */}
      <div style={{ padding: sidebarCollapsed ? '12px' : '24px', borderTop: '1px solid #e5e7eb' }}>
        {!sidebarCollapsed && (
          <p style={{ margin: '0 0 16px 0', fontSize: '11px', color: '#9ca3af' }}>
            Built with care for modern HR
          </p>
        )}
        <button
          onClick={onLogout}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            gap: sidebarCollapsed ? '0' : '12px',
            padding: sidebarCollapsed ? '8px 6px' : '8px 12px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#fecaca';
          }}
          onMouseOut={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#fee2e2';
          }}
          title={sidebarCollapsed ? 'Logout' : undefined}
        >
          <span style={{ fontSize: '16px' }}>🚪</span>
          {!sidebarCollapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
}

export default SideNav;
