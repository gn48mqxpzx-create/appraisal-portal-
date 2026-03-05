import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { getContactByEmail } from "./hubspot/hubspotService";

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
  sm_owner_id: string | null;
  rm_name: string | null;
  staff_id: string | null;
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

    // Look up contact in HubSpot
    const contact = await getContactByEmail(email);
    
    if (!contact) {
      res.status(404).json({ error: "Email not found in HubSpot contacts" });
      return;
    }

    const props = contact.properties;
    
    // Extract properties
    const firstName = props.firstname || "";
    const lastName = props.lastname || "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
    const staffId = props.staff_id_number || null;
    const smOwnerId = props.sm || null;
    const rmName = props.senior_success_manager || null;

    // Determine viewer type
    let viewerType: "SM" | "RM" | "UNSCOPED";
    if (smOwnerId) {
      viewerType = "SM";
    } else if (rmName) {
      viewerType = "RM";
    } else {
      viewerType = "UNSCOPED";
    }

    // Build viewer context
    const viewer: ViewerContext = {
      viewer_email: email,
      viewer_full_name: fullName,
      viewer_type: viewerType,
      sm_owner_id: smOwnerId,
      rm_name: rmName,
      staff_id: staffId
    };

    // Generate JWT token
    const token = jwt.sign(viewer, getJwtSecret(), {
      expiresIn: "7d"
    });

    res.status(200).json({
      token,
      viewer
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    if (errorMessage.includes("Missing HUBSPOT_API_TOKEN")) {
      res.status(500).json({
        error: "Missing HUBSPOT_API_TOKEN. Please set HUBSPOT_API_TOKEN in the API environment."
      });
      return;
    }

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
        sm_owner_id: decoded.sm_owner_id,
        rm_name: decoded.rm_name,
        staff_id: decoded.staff_id
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
