import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type TenureBand = {
  id: string;
  name: string;
  minMonths: number;
  maxMonths: number;
};

type Benchmark = {
  id: string;
  staffRole: string;
  tenureBandId: string;
  baseSalary: number;
  catchupPercent: number | null;
  tenureBand: TenureBand;
};

export function MarketBenchmarksPage() {
  const [tenureBands, setTenureBands] = useState<TenureBand[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states for tenure band
  const [newBandName, setNewBandName] = useState("");
  const [newBandMinMonths, setNewBandMinMonths] = useState("");
  const [newBandMaxMonths, setNewBandMaxMonths] = useState("");

  // Form states for benchmark
  const [newBenchmarkRole, setNewBenchmarkRole] = useState("");
  const [newBenchmarkTenureBandId, setNewBenchmarkTenureBandId] = useState("");
  const [newBenchmarkBaseSalary, setNewBenchmarkBaseSalary] = useState("");
  const [newBenchmarkCatchup, setNewBenchmarkCatchup] = useState("");

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bandsRes, benchmarksRes] = await Promise.all([
        fetch(`${API_BASE}/market/tenure-bands`),
        fetch(`${API_BASE}/market/benchmarks`),
      ]);

      const bandsData = await bandsRes.json();
      const benchmarksData = await benchmarksRes.json();

      if (bandsData.success) setTenureBands(bandsData.data);
      if (benchmarksData.success) setBenchmarks(benchmarksData.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenureBand = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/market/tenure-bands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBandName,
          minMonths: parseInt(newBandMinMonths, 10),
          maxMonths: parseInt(newBandMaxMonths, 10),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setNewBandName("");
        setNewBandMinMonths("");
        setNewBandMaxMonths("");
        loadData();
      } else {
        setError(data.error?.message || "Failed to create tenure band");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCreateBenchmark = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/market/benchmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffRole: newBenchmarkRole,
          tenureBandId: newBenchmarkTenureBandId,
          baseSalary: parseFloat(newBenchmarkBaseSalary),
          catchupPercent: newBenchmarkCatchup ? parseInt(newBenchmarkCatchup, 10) : null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setNewBenchmarkRole("");
        setNewBenchmarkTenureBandId("");
        setNewBenchmarkBaseSalary("");
        setNewBenchmarkCatchup("");
        loadData();
      } else {
        setError(data.error?.message || "Failed to create benchmark");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleUploadBenchmarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      const res = await fetch(`${API_BASE}/market/benchmarks/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setUploadResult(data.data);
        setUploadFile(null);
        loadData();
      } else {
        setError(data.error?.message || "Failed to upload benchmarks");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Market Benchmarks Admin</h2>
        <p className="mt-1 text-sm text-gray-600">Manage tenure bands and market benchmark rules</p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Create Tenure Band */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Create Tenure Band</h3>
        <form onSubmit={handleCreateTenureBand} className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Band Name</label>
            <input
              type="text"
              value={newBandName}
              onChange={(e) => setNewBandName(e.target.value)}
              placeholder="e.g., 0-6 months"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Months</label>
            <input
              type="number"
              value={newBandMinMonths}
              onChange={(e) => setNewBandMinMonths(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Months</label>
            <input
              type="number"
              value={newBandMaxMonths}
              onChange={(e) => setNewBandMaxMonths(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create Band
            </button>
          </div>
        </form>
      </section>

      {/* Tenure Bands List */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Tenure Bands</h3>
        {tenureBands.length === 0 ? (
          <p className="text-sm text-gray-600">No tenure bands defined yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Min Months</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Max Months</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tenureBands.map((band) => (
                  <tr key={band.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">{band.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{band.minMonths}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{band.maxMonths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Benchmark */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Create/Update Benchmark</h3>
        <form onSubmit={handleCreateBenchmark} className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Staff Role</label>
            <input
              type="text"
              value={newBenchmarkRole}
              onChange={(e) => setNewBenchmarkRole(e.target.value)}
              placeholder="e.g., Community Manager"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tenure Band</label>
            <select
              value={newBenchmarkTenureBandId}
              onChange={(e) => setNewBenchmarkTenureBandId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Select Band</option>
              {tenureBands.map((band) => (
                <option key={band.id} value={band.id}>
                  {band.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base Salary</label>
            <input
              type="number"
              step="0.01"
              value={newBenchmarkBaseSalary}
              onChange={(e) => setNewBenchmarkBaseSalary(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Catchup % (optional)
            </label>
            <input
              type="number"
              value={newBenchmarkCatchup}
              onChange={(e) => setNewBenchmarkCatchup(e.target.value)}
              placeholder="1-100"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save Benchmark
            </button>
          </div>
        </form>
      </section>

      {/* Upload CSV */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Upload Benchmarks CSV</h3>
        <p className="text-sm text-gray-600 mb-3">
          CSV Headers: <span className="font-mono">Staff Role, Tenure Band Name, Benchmark Base Salary, Catch Up Percent</span>
        </p>
        <form onSubmit={handleUploadBenchmarks} className="flex gap-4 items-end">
          <div className="flex-1">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!uploadFile}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Upload
          </button>
        </form>
        {uploadResult && (
          <div className="mt-4 rounded-md bg-green-50 border border-green-200 p-3">
            <p className="text-sm text-green-800">
              Uploaded {uploadResult.imported} of {uploadResult.total} rows. {uploadResult.flagged} flagged.
            </p>
            {uploadResult.questionableRows && uploadResult.questionableRows.length > 0 && (
              <details className="mt-2">
                <summary className="text-sm text-green-900 cursor-pointer font-medium">
                  View Questionable Rows
                </summary>
                <pre className="mt-2 text-xs text-gray-700 overflow-auto">
                  {JSON.stringify(uploadResult.questionableRows, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Benchmarks List */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Market Benchmarks</h3>
        {loading && <p className="text-sm text-gray-600">Loading...</p>}
        {!loading && benchmarks.length === 0 && (
          <p className="text-sm text-gray-600">No benchmarks defined yet.</p>
        )}
        {!loading && benchmarks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Staff Role</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tenure Band</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Base Salary</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Catchup %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {benchmarks.map((bm) => (
                  <tr key={bm.id}>
                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">{bm.staffRole}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{bm.tenureBand.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">${Number(bm.baseSalary).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{bm.catchupPercent ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
