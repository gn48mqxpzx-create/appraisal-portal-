const HUBSPOT_API_BASE = "https://api.hubapi.com";

/**
 * Get the HubSpot API token from environment with proper validation and sanitization
 * @returns The sanitized HubSpot API token
 * @throws Error if token is missing or empty
 */
export function getHubSpotToken(): string {
  let token = (process.env.HUBSPOT_API_TOKEN ?? "").trim();
  
  if (!token) {
    throw new Error("Missing HUBSPOT_API_TOKEN");
  }
  
  // Strip surrounding quotes that may have been added when copying the token
  token = token.replace(/^['"]|['"]$/g, "");
  
  return token;
}

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

interface HubSpotOwnersResponse {
  results: HubSpotOwner[];
  paging?: {
    next?: {
      after: string;
    };
  };
}

let ownersCache: HubSpotOwner[] | null = null;
let ownersCacheTimestamp = 0;
const OWNERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all HubSpot owners with caching
 * @returns Array of HubSpot owners
 */
export async function fetchHubSpotOwners(): Promise<HubSpotOwner[]> {
  const now = Date.now();
  if (ownersCache && (now - ownersCacheTimestamp) < OWNERS_CACHE_TTL) {
    return ownersCache;
  }

  const allOwners: HubSpotOwner[] = [];
  let after: string | undefined;

  do {
    const path = after 
      ? `/crm/v3/owners/?limit=100&after=${after}`
      : "/crm/v3/owners/?limit=100";
    
    const data = await hubspotFetch(path, {
      method: "GET"
    }) as HubSpotOwnersResponse;

    allOwners.push(...data.results);
    after = data.paging?.next?.after;
  } while (after);

  ownersCache = allOwners;
  ownersCacheTimestamp = now;
  return allOwners;
}

/**
 * Resolve owner ID from display name (e.g., "Rocci Damole" -> owner ID)
 * @param displayName - Full name of the owner
 * @returns Owner ID or null if not found
 */
export async function resolveOwnerIdByName(displayName: string): Promise<string | null> {
  const owners = await fetchHubSpotOwners();
  const normalized = displayName.trim().toLowerCase();
  
  const match = owners.find((owner) => {
    const fullName = `${owner.firstName} ${owner.lastName}`.trim().toLowerCase();
    return fullName === normalized;
  });

  return match ? match.id : null;
}

/**
 * Make a fetch request to the HubSpot API with proper authentication
 * @param path - The API path (e.g., "/crm/v3/objects/contacts/search")
 * @param init - Fetch request options
 * @returns The parsed JSON response
 * @throws Error with status and body details if the request fails
 */
export async function hubspotFetch(path: string, init?: RequestInit): Promise<any> {
  const token = getHubSpotToken();
  const url = `${HUBSPOT_API_BASE}${path}`;
  
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    ...(init?.headers as Record<string, string> || {})
  };
  
  // Add Content-Type for POST/PUT/PATCH requests
  if (init?.method && ["POST", "PUT", "PATCH"].includes(init.method.toUpperCase())) {
    headers["Content-Type"] = "application/json";
  }
  
  try {
    const response = await fetch(url, {
      ...init,
      headers
    });
    
    if (!response.ok) {
      let errorBody = "";
      try {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const errorData = await response.json();
          errorBody = JSON.stringify(errorData);
        } else {
          errorBody = await response.text();
        }
      } catch {
        errorBody = response.statusText;
      }
      
      throw new Error(`HubSpot API error: ${response.status} - ${errorBody}`);
    }
    
    return await response.json();
  } catch (error) {
    // Ensure we don't log the token in error messages
    if (error instanceof Error && error.message.includes(token)) {
      error.message = error.message.replace(new RegExp(token, "g"), "[REDACTED]");
    }
    throw error;
  }
}
