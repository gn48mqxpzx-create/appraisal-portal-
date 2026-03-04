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
