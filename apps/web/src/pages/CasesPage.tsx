import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type CaseRow = {
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
  wsll_gate_status?: string | null;
  final_new_base?: number;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// Storage keys for localStorage
const VIEWER_ROLE_KEY = "cases_viewer_role";
const VIEWER_NAME_KEY = "cases_viewer_name";

export function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Viewer Identification (temporary until auth)
  const [viewerRole, setViewerRole] = useState<string>(() => {
    return localStorage.getItem(VIEWER_ROLE_KEY) || "SM";
  });
  const [viewerName, setViewerName] = useState<string>(() => {
    return localStorage.getItem(VIEWER_NAME_KEY) || "";
  });

  // Filters & Pagination
  const [search, setSearch] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [staffRole, setStaffRole] = useState<string>("");
  const [contactType, setContactType] = useState<string>("");
  const [includeRemoved, setIncludeRemoved] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [total, setTotal] = useState<number>(0);

  // Persist viewer identification to localStorage
  useEffect(() => {
    localStorage.setItem(VIEWER_ROLE_KEY, viewerRole);
    localStorage.setItem(VIEWER_NAME_KEY, viewerName);
  }, [viewerRole, viewerName]);

  // Auto-default Contact Type for SM/RM viewers
  useEffect(() => {
    if ((viewerRole === "SM" || viewerRole === "RM") && contactType === "") {
      setContactType("Staff Member - Active");
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRole]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set("viewerRole", viewerRole);
    params.set("viewerName", viewerName);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (staffRole) params.set("staffRole", staffRole);
    if (contactType) params.set("contactType", contactType);
    if (includeRemoved) params.set("includeRemoved", "true");
    return `${API_BASE}/cases?${params.toString()}`;
  }, [page, pageSize, search, status, staffRole, contactType, includeRemoved, viewerRole, viewerName]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(endpoint);
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json?.error?.message ?? "Failed to load cases.");
        }

        if (!cancelled) {
          setCases(json?.data?.items ?? []);
          setTotal(json?.data?.total ?? 0);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load cases.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const totalPages = Math.ceil(total / pageSize);
  const uniqueStatuses = Array.from(new Set(cases.map((c) => c.status))).sort();
  const uniqueStaffRoles: string[] = Array.from(new Set(cases.map((c) => c.staff_role).filter((role): role is string => Boolean(role)))).sort();
  const uniqueContactTypes: string[] = Array.from(new Set(cases.map((c) => c.contact_type).filter((type): type is string => Boolean(type)))).sort();

  const handleClearFilters = () => {
    setSearch("");
    setStatus("");
    setStaffRole("");
    setContactType("");
    setIncludeRemoved(false);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Viewer Panel (Temporary) */}
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="mb-3 text-sm font-semibold text-amber-900">Temporary Viewer Identification</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="viewer-role-select" className="block text-xs font-medium text-amber-900 mb-1">Viewer Role</label>
            <select
              id="viewer-role-select"
              aria-label="Viewer Role"
              title="Viewer Role"
              value={viewerRole}
              onChange={(e) => {
                setViewerRole(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="SM">Success Manager (SM)</option>
              <option value="RM">Relationship Manager (RM)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-amber-900 mb-1">Viewer Name (Full Name)</label>
            <input
              type="text"
              placeholder="e.g., John Smith"
              value={viewerName}
              onChange={(e) => {
                setViewerName(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-amber-700">
          <strong>Note:</strong> This viewer identification panel is temporary. Once real authentication (OTP) is implemented, this will be replaced with session management.
        </p>
      </section>

      {/* Header */}
      <section className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Cases</h2>
          <p className="mt-1 text-sm text-gray-600">Manage appraisal cases for the active cycle</p>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </section>
      )}

      {/* Filters */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Search Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                placeholder="Staff ID or Name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            {/* Status Dropdown */}
            <div>
              <label htmlFor="cases-status-filter" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                id="cases-status-filter"
                aria-label="Status"
                title="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="">All Statuses</option>
                {uniqueStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Staff Role Dropdown */}
            <div>
              <label htmlFor="cases-staff-role-filter" className="block text-sm font-medium text-gray-700 mb-1">Staff Role</label>
              <select
                id="cases-staff-role-filter"
                aria-label="Staff Role"
                title="Staff Role"
                value={staffRole}
                onChange={(e) => {
                  setStaffRole(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="">All Roles</option>
                {uniqueStaffRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            {/* Contact Type Dropdown */}
            <div>
              <label htmlFor="cases-contact-type-filter" className="block text-sm font-medium text-gray-700 mb-1">Contact Type</label>
              <select
                id="cases-contact-type-filter"
                aria-label="Contact Type"
                title="Contact Type"
                value={contactType}
                onChange={(e) => {
                  setContactType(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              >
                <option value="">All Types</option>
                {uniqueContactTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Include Removed Toggle */}
            <div className="flex items-end">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeRemoved}
                  onChange={(e) => {
                    setIncludeRemoved(e.target.checked);
                    setPage(1);
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700">Include Removed</span>
              </label>
            </div>

            {/* Clear Filters Button */}
            <div className="flex items-end">
              <button
                onClick={handleClearFilters}
                className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Row count */}
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{cases.length}</span> of{" "}
            <span className="font-semibold">{total}</span> cases
          </div>
        </div>
      </section>

      {/* Loading State */}
      {loading && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-600">Loading cases...</p>
        </section>
      )}

      {/* Cases Table */}
      {!loading && !error && (
        <>
          <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            {cases.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-gray-600">No cases found. Try adjusting your filters or viewer role.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Staff ID</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Role</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Contact Type</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Success Manager</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Relationship Manager</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {cases.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 font-medium">{c.staff_id}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{c.full_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{c.staff_role ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{c.contact_type ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{c.success_manager ?? "-"}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{c.relationship_manager ?? "-"}</td>
                                                <td className="px-4 py-3">
                                                  {c.wsll_gate_status ? (
                                                    <span
                                                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                        c.wsll_gate_status === "PASS"
                                                          ? "bg-green-100 text-green-800"
                                                          : c.wsll_gate_status === "FAIL"
                                                          ? "bg-red-100 text-red-800"
                                                          : "bg-yellow-100 text-yellow-800"
                                                      }`}
                                                    >
                                                      {c.wsll_gate_status}
                                                    </span>
                                                  ) : (
                                                    <span className="text-sm text-gray-400">-</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-700">
                                                  {c.final_new_base ? `$${Number(c.final_new_base).toFixed(2)}` : "-"}
                                                </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">WSLL Gate</th>
                                                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Final New Base</th>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <Link
                            to={`/cases/${c.id}?viewerRole=${encodeURIComponent(viewerRole)}&viewerName=${encodeURIComponent(viewerName)}`}
                            className="text-blue-600 hover:text-blue-900 font-medium"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pagination */}
          {totalPages > 1 && (
            <section className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-600">
                Page <span className="font-semibold">{page}</span> of{" "}
                <span className="font-semibold">{totalPages}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}