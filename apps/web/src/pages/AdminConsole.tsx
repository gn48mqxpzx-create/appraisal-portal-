import { ViewerSession } from '../utils/auth';

interface AdminConsoleProps {
  viewerSession: ViewerSession | null;
}

export function AdminConsole({ viewerSession }: AdminConsoleProps) {
  return (
    <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '600', margin: '0 0 8px 0', color: '#1f2937' }}>
          Admin Console
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
          Manage system configuration and data synchronization
        </p>

        <div style={{
          backgroundColor: '#fff',
          padding: '40px 24px',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚙️</div>
          <p style={{ fontSize: '16px', margin: '0 0 8px 0', fontWeight: '500' }}>
            Admin Console functionality
          </p>
          <p style={{ fontSize: '13px', margin: 0, color: '#9ca3af' }}>
            Coming soon. Manage system configuration and sync operations here.
          </p>
        </div>
      </div>
    </div>
  );
}

export default AdminConsole;
