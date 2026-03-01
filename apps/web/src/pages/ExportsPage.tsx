import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// Storage key for localStorage
const VIEWER_ROLE_KEY = "cases_viewer_role";

export function ExportsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerRole = localStorage.getItem(VIEWER_ROLE_KEY) || "ADMIN";

  const handleDownloadPayrollExport = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/exports/payroll`);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to download payroll export");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (viewerRole !== "ADMIN") {
    return (
      <div className="space-y-6">
        <section>
          <h2 className="text-2xl font-semibold text-gray-900">Exports</h2>
          <p className="mt-1 text-sm text-gray-600">Download data exports for finance and payroll</p>
        </section>

        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            <strong>Access Restricted:</strong> Only ADMIN users can access exports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Exports</h2>
        <p className="mt-1 text-sm text-gray-600">Download data exports for finance and payroll</p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Payroll Export</h3>
        <p className="text-sm text-gray-600 mb-4">
          Export final approved salaries for cases in PAYROLL_PROCESSED or LOCKED status. The CSV includes:
        </p>
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 mb-6">
          <li>Staff ID, Name, Company, Role</li>
          <li>Current Base Salary</li>
          <li>Final New Base Salary (after overrides)</li>
          <li>Increase Amount and Percentage</li>
          <li>Effectivity Date</li>
          <li>Approval Reference Summary (PDF count, HubSpot link count)</li>
        </ul>

        <button
          onClick={handleDownloadPayrollExport}
          disabled={loading}
          className="rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Generating..." : "Download Payroll Export CSV"}
        </button>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">Export Information</h3>
        <ul className="list-disc list-inside text-sm text-blue-800 space-y-1">
          <li>Only cases in PAYROLL_PROCESSED or LOCKED status are included</li>
          <li>Export includes all cycles by default</li>
          <li>Final new base reflects any overrides applied</li>
          <li>Approval reference shows count of PDF uploads and HubSpot links</li>
        </ul>
      </section>
    </div>
  );
}
