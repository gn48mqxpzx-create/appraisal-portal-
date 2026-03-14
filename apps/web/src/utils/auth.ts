export type Role = 'SM' | 'RM' | 'Admin';

export interface Permissions {
  canViewDashboard: boolean;
  canViewCases: boolean;
  canViewReviewQueue: boolean;
  canViewWsll: boolean;
  canEditWsll: boolean;
  canUploadWsll: boolean;
  canViewPayrollExport: boolean;
  canViewAdminConsole: boolean;
}

export interface ViewerSession {
  viewer_type: 'SM' | 'RM';
  viewer_email: string;
  viewer_name: string;
  role: Role;
  permissions: Permissions;
  scope_summary: {
    total_sm_count: number;
    total_va_count: number;
  };
  virtual_assistants?: any[];
  success_managers?: any[];
}

const ADMIN_EMAIL = 'uly@vaplatinum.com.au';
const VIEWER_SESSION_KEY = 'viewerSession';
const LEGACY_VIEWER_KEYS = ['cases_viewer_role', 'cases_viewer_name'];

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Determine role from viewer data with admin override
 */
export function determineRole(viewerEmail: string, viewerType: 'SM' | 'RM'): Role {
  // Admin override
  if (normalizeEmail(viewerEmail) === normalizeEmail(ADMIN_EMAIL)) {
    return 'Admin';
  }

  // Map viewer type to role
  return viewerType === 'RM' ? 'RM' : 'SM';
}

/**
 * Get permissions based on role
 */
export function getPermissionsForRole(role: Role): Permissions {
  switch (role) {
    case 'Admin':
      return {
        canViewDashboard: true,
        canViewCases: true,
        canViewReviewQueue: true,
        canViewWsll: true,
        canEditWsll: true,
        canUploadWsll: true,
        canViewPayrollExport: true,
        canViewAdminConsole: true
      };
    
    case 'RM':
      return {
        canViewDashboard: true,
        canViewCases: true,
        canViewReviewQueue: true,
        canViewWsll: true,
        canEditWsll: false,
        canUploadWsll: false,
        canViewPayrollExport: false,
        canViewAdminConsole: false
      };
    
    case 'SM':
      return {
        canViewDashboard: true,
        canViewCases: true,
        canViewReviewQueue: false,
        canViewWsll: true,
        canEditWsll: false,
        canUploadWsll: false,
        canViewPayrollExport: false,
        canViewAdminConsole: false
      };
    
    default:
      return {
        canViewDashboard: false,
        canViewCases: false,
        canViewReviewQueue: false,
        canViewWsll: false,
        canEditWsll: false,
        canUploadWsll: false,
        canViewPayrollExport: false,
        canViewAdminConsole: false
      };
  }
}

/**
 * Enrich viewer data with role and permissions
 */
export function enrichViewerSession(viewerData: any): ViewerSession {
  const role = determineRole(viewerData.viewer_email, viewerData.viewer_type);
  const permissions = getPermissionsForRole(role);

  return {
    ...viewerData,
    role,
    permissions
  };
}

/**
 * Save viewer session to localStorage
 */
export function saveViewerSession(session: ViewerSession): void {
  localStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify(session));
}

/**
 * Load viewer session from localStorage
 */
export function loadViewerSession(): ViewerSession | null {
  const stored = localStorage.getItem(VIEWER_SESSION_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Clear viewer session
 */
export function clearViewerSession(): void {
  localStorage.removeItem(VIEWER_SESSION_KEY);
  LEGACY_VIEWER_KEYS.forEach((key) => localStorage.removeItem(key));
}

/**
 * Check if user has permission for a specific page
 */
export function canAccessPage(permissions: Permissions, pageId: string): boolean {
  switch (pageId) {
    case 'dashboard':
      return permissions.canViewDashboard;
    case 'cases':
      return permissions.canViewCases;
    case 'case-detail':
      return permissions.canViewCases;
    case 'review-queue':
      return permissions.canViewReviewQueue;
    case 'wsll':
      return permissions.canViewWsll;
    case 'payroll':
      return permissions.canViewPayrollExport;
    case 'admin':
      return permissions.canViewAdminConsole;
    default:
      return false;
  }
}
