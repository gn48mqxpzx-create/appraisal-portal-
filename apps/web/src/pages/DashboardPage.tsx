import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function DashboardPage() {
  const [inScopeEmployees, setInScopeEmployees] = useState<string>("—");

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const response = await fetch(`${API_BASE}/dashboard/summary`);
        if (!response.ok) {
          setInScopeEmployees("—");
          return;
        }

        const payload = (await response.json()) as {
          data?: {
            inScopeEmployees?: number;
          };
        };
        const count = payload.data?.inScopeEmployees;
        setInScopeEmployees(typeof count === "number" ? String(count) : "—");
      } catch {
        setInScopeEmployees("—");
      }
    };

    void loadSummary();
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Dashboard</h2>
        <p className="mt-1 text-sm text-gray-600">Overview of cycle progress, blockers, and release readiness.</p>
      </section>

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

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-medium text-gray-800">Recent Activity</h3>
        <p className="mt-2 text-sm text-gray-600">No activity yet. Connect API endpoints to populate this feed.</p>
      </section>
    </div>
  );
}
