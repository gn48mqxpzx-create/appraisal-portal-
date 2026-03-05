import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface ScopeData {
  viewer_type: string;
  sm_owner_id?: string;
  rm?: string;
  count?: number;
  total_staff?: number;
  staff?: Array<{
    hubspot_id: string;
    staff_id: string;
    full_name: string;
    email: string;
    staff_role: string;
    contact_type: string;
    sm_owner_id: string;
    rm: string;
  }>;
  sm_groups?: Array<{
    sm_owner_id: string;
    count: number;
    staff: Array<{
      hubspot_id: string;
      staff_id: string;
      full_name: string;
      email: string;
      staff_role: string;
      contact_type: string;
      sm_owner_id: string;
      rm: string;
    }>;
  }>;
}

interface ViewerInfo {
  viewer_email: string;
  viewer_full_name: string;
  viewer_type: string;
  sm_owner_id: string | null;
  rm_name: string | null;
  staff_id: string | null;
}

export function DashboardPage() {
  const [inScopeEmployees, setInScopeEmployees] = useState<string>("—");
  const [scopeData, setScopeData] = useState<ScopeData | null>(null);
  const [viewerInfo, setViewerInfo] = useState<ViewerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const token = localStorage.getItem("authToken");

        if (!token) {
          setError("No authentication token found");
          return;
        }

        // Fetch viewer info
        const viewerResponse = await fetch(`${API_BASE}/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!viewerResponse.ok) {
          throw new Error("Failed to fetch viewer info");
        }

        const viewer = (await viewerResponse.json()) as ViewerInfo;
        setViewerInfo(viewer);

        // Fetch scoped data
        const scopeResponse = await fetch(`${API_BASE}/scope/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!scopeResponse.ok) {
          throw new Error("Failed to fetch scoped data");
        }

        const scope = (await scopeResponse.json()) as ScopeData;
        setScopeData(scope);

        // Calculate staff count
        if (scope.viewer_type === "SM") {
          setInScopeEmployees(String(scope.count ?? 0));
        } else if (scope.viewer_type === "RM") {
          setInScopeEmployees(String(scope.total_staff ?? 0));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setInScopeEmployees("—");
      } finally {
        setIsLoading(false);
      }
    };

    void loadData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Dashboard</h2>
        <p className="mt-1 text-sm text-gray-600">Overview of cycle progress, blockers, and release readiness.</p>
      </section>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {viewerInfo && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-gray-900">Viewer Information</h3>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-500">Full Name</dt>
              <dd className="mt-1 text-sm text-gray-900">{viewerInfo.viewer_full_name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Email</dt>
              <dd className="mt-1 text-sm text-gray-900">{viewerInfo.viewer_email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Role</dt>
              <dd className="mt-1 text-sm text-gray-900">{viewerInfo.viewer_type}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Staff ID</dt>
              <dd className="mt-1 text-sm text-gray-900">{viewerInfo.staff_id || "—"}</dd>
            </div>
            {viewerInfo.viewer_type === "SM" && (
              <div>
                <dt className="text-sm font-medium text-gray-500">SM Owner ID</dt>
                <dd className="mt-1 text-sm text-gray-900">{viewerInfo.sm_owner_id || "—"}</dd>
              </div>
            )}
            {viewerInfo.viewer_type === "RM" && (
              <div>
                <dt className="text-sm font-medium text-gray-500">RM Name</dt>
                <dd className="mt-1 text-sm text-gray-900">{viewerInfo.rm_name || "—"}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">In-Scope Employees</p>
          <p className="mt-2 text-2xl font-semibold">{inScopeEmployees}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Approved</p>
          <p className="mt-2 text-2xl font-semibold">—</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Blocked</p>
          <p className="mt-2 text-2xl font-semibold">—</p>
        </div>
      </section>

      {scopeData && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-gray-900">Scope Data (Raw)</h3>
          <pre className="mt-4 overflow-auto rounded bg-gray-50 p-4 text-xs">
            {JSON.stringify(scopeData, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-medium text-gray-800">Recent Activity</h3>
        <p className="mt-2 text-sm text-gray-600">No activity yet. Connect API endpoints to populate this feed.</p>
      </section>
    </div>
  );
}
