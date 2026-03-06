import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type ViewerType = "SM" | "RM";

interface StaffMember {
  hubspot_id: string;
  staff_id: string;
  full_name: string;
  email: string;
  staff_role: string;
  contact_type: string;
  sm_owner_id: string;
  sm_own_owner_id: string;
  rm: string;
  employee_type: string;
}

interface SMDirectoryResponse {
  viewer_type: "SM";
  sm_name: string;
  total_va_count: number;
  virtual_assistants: StaffMember[];
}

interface RMDirectoryResponse {
  viewer_type: "RM";
  rm_name: string;
  total_sm_count: number;
  total_va_count: number;
  success_managers: StaffMember[];
  virtual_assistants: StaffMember[];
}

type DirectoryResponse = SMDirectoryResponse | RMDirectoryResponse;

export function DashboardPage() {
  const [viewerType, setViewerType] = useState<ViewerType>("SM");
  const [smOwnerId, setSmOwnerId] = useState<string>("236163946");
  const [rmName, setRmName] = useState<string>("Rocci Damole");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DirectoryResponse | null>(null);

  const handleLoadDirectory = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setData(null);

      let url: string;
      if (viewerType === "SM") {
        url = `${API_BASE}/directory/sm/${encodeURIComponent(smOwnerId)}`;
      } else {
        url = `${API_BASE}/directory/rm/${encodeURIComponent(rmName)}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch directory: ${response.statusText}`);
      }

      const result = (await response.json()) as DirectoryResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Employee Directory</h2>
        <p className="mt-1 text-sm text-gray-600">
          Testing viewer-scoped directory endpoints (temporary controls)
        </p>
      </section>

      {/* Viewer Selector Controls */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Viewer Controls</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="viewerType" className="block text-sm font-medium text-gray-700 mb-1">
              Viewer Type
            </label>
            <select
              id="viewerType"
              value={viewerType}
              onChange={(e) => setViewerType(e.target.value as ViewerType)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
            >
              <option value="SM">SM</option>
              <option value="RM">RM</option>
            </select>
          </div>

          {viewerType === "SM" && (
            <div>
              <label htmlFor="smOwnerId" className="block text-sm font-medium text-gray-700 mb-1">
                SM Owner ID
              </label>
              <input
                id="smOwnerId"
                type="text"
                value={smOwnerId}
                onChange={(e) => setSmOwnerId(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
              />
            </div>
          )}

          {viewerType === "RM" && (
            <div>
              <label htmlFor="rmName" className="block text-sm font-medium text-gray-700 mb-1">
                RM Name
              </label>
              <input
                id="rmName"
                type="text"
                value={rmName}
                onChange={(e) => setRmName(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
              />
            </div>
          )}

          <div className="flex items-end">
            <button
              onClick={handleLoadDirectory}
              disabled={isLoading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Loading..." : "Load Directory"}
            </button>
          </div>
        </div>
      </section>

      {/* Error Display */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* SM View */}
      {data && data.viewer_type === "SM" && (
        <>
          {/* Summary Card */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Viewer Type</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.viewer_type}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">SM Owner ID</dt>
                <dd className="mt-1 text-sm text-gray-900">{smOwnerId}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Total VA Count</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.total_va_count}</dd>
              </div>
            </dl>
          </section>

          {/* VAs Table */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Virtual Assistants</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Full Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      RM
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.virtual_assistants.map((va) => (
                    <tr key={va.staff_id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.staff_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.full_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.staff_role}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.contact_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.rm}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* RM View */}
      {data && data.viewer_type === "RM" && (
        <>
          {/* Summary Card */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Viewer Type</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.viewer_type}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">RM Name</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.rm_name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Total SM Count</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.total_sm_count}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Total VA Count</dt>
                <dd className="mt-1 text-sm text-gray-900">{data.total_va_count}</dd>
              </div>
            </dl>
          </section>

          {/* SMs Table */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Success Managers</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Full Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SM Owner ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.success_managers.map((sm) => (
                    <tr key={sm.staff_id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {sm.staff_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {sm.full_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {sm.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {sm.staff_role}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {sm.sm_own_owner_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* VAs Table */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Virtual Assistants</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Full Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Staff Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SM Owner ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.virtual_assistants.map((va) => (
                    <tr key={va.staff_id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.staff_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.full_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.staff_role}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {va.sm_owner_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
