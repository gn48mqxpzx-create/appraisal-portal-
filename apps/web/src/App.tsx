import { useState, useEffect } from 'react';
import styles from './App.module.css';
import SideNav from './components/layout/SideNav';
import Dashboard from './pages/Dashboard';
import AppraisalCases from './pages/AppraisalCases';
import WsllUpload from './pages/WsllUpload';
import PayrollExport from './pages/PayrollExport';
import AdminConsole from './pages/AdminConsole';
import LoginPage from './pages/LoginPage';
import CaseDetailPage from './pages/CaseDetailPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import { 
  ViewerSession, 
  enrichViewerSession, 
  saveViewerSession, 
  loadViewerSession,
  clearViewerSession,
  canAccessPage
} from './utils/auth';
import { type WorkflowStageFilter } from './utils/workflowStage';

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const fetchExactViewerSession = async (email: string): Promise<ViewerSession> => {
  const normalizedEmail = normalizeEmail(email);
  const response = await fetch(`http://localhost:3001/directory/viewer/${encodeURIComponent(normalizedEmail)}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.details || 'Failed to load viewer data');
  }

  const data = await response.json();
  const resolvedEmail = normalizeEmail(data.viewer_email || '');

  if (resolvedEmail !== normalizedEmail) {
    throw new Error(`Viewer identity mismatch: requested ${normalizedEmail} but resolved ${resolvedEmail || 'unknown'}`);
  }

  return enrichViewerSession(data);
};

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [viewerSession, setViewerSession] = useState<ViewerSession | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [caseStatusFilterFromDashboard, setCaseStatusFilterFromDashboard] = useState<WorkflowStageFilter>('ALL');
  const [caseFilterVersion, setCaseFilterVersion] = useState<number>(0);

  // Check for existing session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const existingSession = loadViewerSession();
      if (!existingSession?.viewer_email) {
        setIsCheckingSession(false);
        return;
      }

      try {
        const refreshed = await fetchExactViewerSession(existingSession.viewer_email);
        saveViewerSession(refreshed);
        setViewerSession(refreshed);
      } catch {
        clearViewerSession();
        setViewerSession(null);
      } finally {
        setIsCheckingSession(false);
      }
    };

    void restoreSession();
  }, []);

  const handleLogin = async (email: string) => {
    clearViewerSession();
    const session = await fetchExactViewerSession(email);
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

  const handleDashboardNavigate = (destination: 'cases' | 'review-queue', caseStatusFilter?: WorkflowStageFilter) => {
    if (destination === 'cases') {
      setCaseStatusFilterFromDashboard(caseStatusFilter || 'ALL');
      setCaseFilterVersion((prev) => prev + 1);
      setCurrentPage('cases');
      return;
    }

    setCurrentPage('review-queue');
  };

  const handleViewCase = (staffId: string) => {
    setSelectedStaffId(staffId);
    setCurrentPage('case-detail');
  };

  const handleBackToCases = () => {
    setSelectedStaffId(null);
    setCurrentPage('cases');
  };

  // Show loading state while checking for existing session
  if (isCheckingSession) {
    return (
      <div className={styles.loadingContainer}>
        <p className={styles.loadingText}>Loading...</p>
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
      <div className={styles.appLayout}>
        <SideNav 
          currentPage={currentPage} 
          onNavigate={handleNavigate} 
          viewerSession={viewerSession}
          onLogout={handleLogout}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div className={`${styles.mainContent} ${sidebarCollapsed ? styles.mainContentExpanded : styles.mainContentCollapsed}`}>
          <div className={styles.accessDeniedContainer}>
            <div className={styles.accessDeniedInner}>
              <div className={styles.accessDeniedBox}>
                <div className={styles.accessDeniedIcon}>🔒</div>
                <p className={styles.accessDeniedTitle}>
                  Access Denied
                </p>
                <p className={styles.accessDeniedMessage}>
                  You don't have permission to access this page.
                </p>
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  className={styles.accessDeniedButton}
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
        return <Dashboard viewerSession={viewerSession} onNavigate={handleDashboardNavigate} />;
      case 'cases':
        return (
          <AppraisalCases
            viewerSession={viewerSession}
            onViewCase={handleViewCase}
            initialCaseStatusFilter={caseStatusFilterFromDashboard}
            filterVersion={caseFilterVersion}
          />
        );
      case 'case-detail':
        return selectedStaffId ? (
          <CaseDetailPage 
            staffId={selectedStaffId} 
            viewerSession={viewerSession} 
            onNavigateBack={handleBackToCases}
          />
        ) : (
          <Dashboard viewerSession={viewerSession} onNavigate={handleDashboardNavigate} />
        );
      case 'review-queue':
        return <ReviewQueuePage viewerSession={viewerSession} />;
      case 'wsll':
        return <WsllUpload viewerSession={viewerSession} />;
      case 'payroll':
        return <PayrollExport viewerSession={viewerSession} />;
      case 'admin':
        return <AdminConsole viewerSession={viewerSession} />;
      default:
        return <Dashboard viewerSession={viewerSession} onNavigate={handleDashboardNavigate} />;
    }
  };

  return (
    <div className={styles.appLayout}>
      <SideNav 
        currentPage={currentPage} 
        onNavigate={handleNavigate} 
        viewerSession={viewerSession}
        onLogout={handleLogout}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className={`${styles.mainContent} ${sidebarCollapsed ? styles.mainContentExpanded : styles.mainContentCollapsed}`}>
        {renderPage()}
      </div>
    </div>
  );
}

export default App;