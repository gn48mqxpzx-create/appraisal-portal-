import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

type MovementLogEntry = {
  id: string;
  movement_type: string;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  timestamp: string;
};

type CaseDetail = {
  id: string;
  staff_id: string;
  full_name: string;
  staff_role?: string | null;
  contact_type?: string | null;
  success_manager?: string | null;
  relationship_manager?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  movement_log: MovementLogEntry[];
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract viewer params from URL query params (from "Open" link)
  const viewerRole = searchParams.get("viewerRole") || "ADMIN";
  const viewerName = searchParams.get("viewerName") || "";

  const endpoint = useMemo(() => {
    if (!id) return null;
    const params = new URLSearchParams();
    params.set("viewerRole", viewerRole);
    params.set("viewerName", viewerName);
    return `${API_BASE}/cases/${id}?${params.toString()}`;
  }, [id, viewerRole, viewerName]);

  useEffect(() => {
    if (!endpoint || !id) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(endpoint);
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json?.error?.message ?? "Failed to load case.");
        }

        if (!cancelled) setData(json?.data ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load case.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [endpoint, id]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Case Detail</h2>
          <p className="mt-1 text-sm text-gray-600">Case ID: {id}</p>
        </div>
        <Link to="/cases" className="rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 font-medium text-gray-700">
          Back to Cases
        </Link>
      </section>

      {/* Loading State */}
      {loading && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-600">Loading case details...</p>
        </section>
      )}

      {/* Error State */}
      {error && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </section>
      )}

      {/* Case Details */}
      {!loading && !error && data && (
        <div className="space-y-6">
          {/* Employee Information Card */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="space-y-4">
              {/* Header: Full Name and Status */}
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-900">{data.full_name}</h3>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {data.status}
                </span>
              </div>

              {/* Grid of Fields */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff ID</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{data.staff_id}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff Role</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{data.staff_role ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Type</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{data.contact_type ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Success Manager</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{data.success_manager ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Relationship Manager</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{data.relationship_manager ?? "-"}</div>
                </div>
                {data.closed_at && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Closed Date</div>
                    <div className="mt-1 text-base font-medium text-gray-900">{formatDate(data.closed_at)}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{formatDate(data.created_at)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Updated</div>
                  <div className="mt-1 text-base font-medium text-gray-900">{formatDate(data.updated_at)}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Movement Log Section */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Movement Log</h3>
            {data.movement_log.length === 0 ? (
              <p className="text-sm text-gray-600">No movement entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Timestamp</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Action</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Field</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Old Value</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">New Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.movement_log.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{formatDateTime(log.timestamp)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-800">
                            {log.movement_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{log.field_name ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{log.old_value ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{log.new_value ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Compensation Review Section (Placeholder) */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Compensation Review</h3>
            <p className="text-sm text-gray-600">
              Placeholder. Salary and compensation details will appear here when available.
            </p>
          </section>

          {/* Client Approval Section (Placeholder) */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Client Approval</h3>
            <p className="text-sm text-gray-600">
              Placeholder. This is where the client email verification and approval flow will be implemented.
              In the future, users will be able to upload PDF documents or approval links here.
            </p>
          </section>
        </div>
      )}

      {!loading && !error && !data && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-600">No case data found.</p>
        </section>
      )}
    </div>
  );
}