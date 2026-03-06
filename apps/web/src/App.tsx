import { useState, useEffect } from 'react';
import SideNav from './components/layout/SideNav';
import Dashboard from './pages/Dashboard';
import AppraisalCases from './pages/AppraisalCases';
import WsllUpload from './pages/WsllUpload';
import PayrollExport from './pages/PayrollExport';
import AdminConsole from './pages/AdminConsole';
import LoginPage from './pages/LoginPage';
import { 
  ViewerSession, 
  enrichViewerSession, 
  saveViewerSession, 
  loadViewerSession,
  clearViewerSession,
  canAccessPage
} from './utils/auth';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [viewerSession, setViewerSession] = useState<ViewerSession | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const existingSession = loadViewerSession();
    if (existingSession) {
      setViewerSession(existingSession);
    }
    setIsCheckingSession(false);
  }, []);

  const handleLogin = async (email: string) => {
    const response = await fetch(`http://localhost:3001/directory/viewer/${encodeURIComponent(email)}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to load viewer data');
    }

    const data = await response.json();
    const session = enrichViewerSession(data);
    saveViewerSession(session);
    setViewerSession(session);
  };

  const handleLogout = () => {
    clearViewerSession();
    setViewerSession(null);
    setCurrentPage('dashboard');
  };

  const handleNavigate = (pageId: string) => {
    // Check if user has permission to access this page
    if (viewerSession && !canAccessPage(viewerSession.permissions, pageId)) {
      // Redirect to dashboard if unauthorized
      setCurrentPage('dashboard');
      return;
    }
    setCurrentPage(pageId);
  };

  // Show loading state while checking for existing session
  if (isCheckingSession) {
    return (
      <div style={{ 
        backgroundColor: '#f9fafb', 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>Loading...</p>
      </div>
    );
  }

  // Show login page if no session
  if (!viewerSession) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Check access before rendering protected pages
  const canAccessCurrentPage = canAccessPage(viewerSession.permissions, currentPage);
  if (!canAccessCurrentPage) {
    // Show access denied message
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <SideNav 
          currentPage={currentPage} 
          onNavigate={handleNavigate} 
          viewerSession={viewerSession}
          onLogout={handleLogout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div style={{ marginLeft: sidebarCollapsed ? '80px' : '280px', flex: 1, width: sidebarCollapsed ? 'calc(100% - 80px)' : 'calc(100% - 280px)', transition: 'all 0.3s ease' }}>
          <div style={{ backgroundColor: '#f9fafb', minHeight: '100vh', padding: '24px' }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
              <div style={{
                backgroundColor: '#fef2f2',
                border: '2px solid #fecaca',
                borderRadius: '8px',
                padding: '60px 24px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
                <p style={{ fontSize: '18px', margin: '0 0 8px 0', fontWeight: '600', color: '#991b1b' }}>
                  Access Denied
                </p>
                <p style={{ fontSize: '14px', margin: '0 0 20px 0', color: '#991b1b' }}>
                  You don't have permission to access this page.
                </p>
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard viewerSession={viewerSession} />;
      case 'cases':
        return <AppraisalCases viewerSession={viewerSession} />;
      case 'wsll':
        return <WsllUpload viewerSession={viewerSession} />;
      case 'payroll':
        return <PayrollExport viewerSession={viewerSession} />;
      case 'admin':
        return <AdminConsole viewerSession={viewerSession} />;
      default:
        return <Dashboard viewerSession={viewerSession} />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SideNav 
        currentPage={currentPage} 
        onNavigate={handleNavigate} 
        viewerSession={viewerSession}
        onLogout={handleLogout}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div style={{ marginLeft: sidebarCollapsed ? '80px' : '280px', flex: 1, width: sidebarCollapsed ? 'calc(100% - 80px)' : 'calc(100% - 280px)', transition: 'all 0.3s ease' }}>
        {renderPage()}
      </div>
    </div>
  );
}

export default App;