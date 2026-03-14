import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { resolveViewerHierarchy } from "./services/hierarchyResolutionService";
import { ViewerNotFoundError, resolveViewerByEmail } from "./services/viewerResolutionService";
import { shouldTriggerSync, syncEmployeeDirectory } from "./services/employeeDirectoryService";

// JWT secret with fallback
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn("⚠️  WARNING: JWT_SECRET not set. Using default 'dev-secret'. DO NOT use in production!");
    return "dev-secret";
  }
  return secret;
};

export interface ViewerContext {
  viewer_email: string;
  viewer_full_name: string;
  viewer_type: "SM" | "RM" | "UNSCOPED";
  viewer_role: "SITE_LEAD" | "SUCCESS_MANAGER" | "RELATIONSHIP_MANAGER" | "REVIEWER" | "UNSCOPED";
  sm_owner_id: string | null;
  rm_name: string | null;
  staff_id: string | null;
  resolved_user_id: string | null;
  scope_staff_count: number;
  unresolved_hierarchy_reason: string | null;
}

export interface JwtPayload extends ViewerContext {
  iat?: number;
  exp?: number;
}

// Extend Express Request to include viewer
declare global {
  namespace Express {
    interface Request {
      viewer?: ViewerContext;
    }
  }
}

/**
 * Login handler - authenticate user by email and return JWT token with viewer context
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  try {
    const email = (req.body?.email ?? "").trim().toLowerCase();
    
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const resolvedViewer = await resolveViewerByEmail(email);
    const hierarchy = await resolveViewerHierarchy({
      email,
      role: resolvedViewer.scopedRole
    });

    let viewerType: "SM" | "RM" | "UNSCOPED" = "UNSCOPED";
    if (hierarchy.scopedRole === "SUCCESS_MANAGER") {
      viewerType = "SM";
    } else if (hierarchy.scopedRole === "RELATIONSHIP_MANAGER") {
      viewerType = "RM";
    }

    const fullName = hierarchy.resolvedViewerRecord?.fullName || resolvedViewer.fullName || email;
    const staffId = hierarchy.resolvedViewerRecord?.staffId || null;
    const smOwnerId = hierarchy.resolvedViewerRecord?.smOwnerId || null;
    const rmName = hierarchy.resolvedViewerRecord?.rmName || hierarchy.rmOwner?.fullName || null;

    // Build viewer context
    const viewer: ViewerContext = {
      viewer_email: email,
      viewer_full_name: fullName,
      viewer_type: viewerType,
      viewer_role: hierarchy.scopedRole,
      sm_owner_id: smOwnerId,
      rm_name: rmName,
      staff_id: staffId,
      resolved_user_id: staffId || hierarchy.rmOwner?.id || null,
      scope_staff_count: hierarchy.scopedStaffIds.length,
      unresolved_hierarchy_reason: hierarchy.unresolvedHierarchyReason
    };

    // Generate JWT token
    const token = jwt.sign(viewer, getJwtSecret(), {
      expiresIn: "7d"
    });

    // Freshness check: trigger background delta sync if last sync is stale (>10 min)
    shouldTriggerSync(10).then((stale) => {
      if (stale) {
        console.log(`[loginHandler] Stale directory — triggering background delta sync for ${email}`);
        syncEmployeeDirectory({ triggeredBy: "login", deltaOnly: true }).catch((err) => {
          console.warn("[loginHandler] Background delta sync failed:", err instanceof Error ? err.message : err);
        });
      }
    }).catch(() => {});

    res.status(200).json({
      token,
      viewer
    });
  } catch (error) {
    if (error instanceof ViewerNotFoundError) {
      res.status(404).json({
        error: "Viewer not found",
        details: `No exact email match for: ${error.email}`
      });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    res.status(500).json({
      error: "Login failed",
      details: errorMessage
    });
  }
}

/**
 * Middleware to require authentication via JWT token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      res.status(401).json({ error: "Invalid Authorization header format. Expected: Bearer <token>" });
      return;
    }

    const token = parts[1];
    
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
      
      // Add viewer to request
      req.viewer = {
        viewer_email: decoded.viewer_email,
        viewer_full_name: decoded.viewer_full_name,
        viewer_type: decoded.viewer_type,
        viewer_role: decoded.viewer_role,
        sm_owner_id: decoded.sm_owner_id,
        rm_name: decoded.rm_name,
        staff_id: decoded.staff_id,
        resolved_user_id: decoded.resolved_user_id,
        scope_staff_count: decoded.scope_staff_count,
        unresolved_hierarchy_reason: decoded.unresolved_hierarchy_reason
      };
      
      next();
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({ error: "Token expired" });
        return;
      }
      if (jwtError instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      throw jwtError;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "Authentication failed",
      details: errorMessage
    });
  }
}

/**
 * GET /me endpoint handler - return current viewer context
 */
export function meHandler(req: Request, res: Response): void {
  if (!req.viewer) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  
  res.status(200).json(req.viewer);
}
