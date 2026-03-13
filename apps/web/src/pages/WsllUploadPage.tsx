import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function WsllUploadPage() {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setLoading(true);
    setError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      const res = await fetch(`${API_BASE}/wsll/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setUploadResult(data.data);
        setUploadFile(null);
      } else {
        setError(data.error?.message || "Failed to upload WSLL scores");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadQuestionableCSV = () => {
    if (!uploadResult || !uploadResult.questionableRows || uploadResult.questionableRows.length === 0) {
      return;
    }

    const headers = Object.keys(uploadResult.questionableRows[0]);
    const csvLines = [headers.join(",")];

    for (const row of uploadResult.questionableRows) {
      const line = headers.map((h) => row[h] || "").join(",");
      csvLines.push(line);
    }

    const csvContent = csvLines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wsll-questionable-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">WSLL Score Upload</h2>
        <p className="mt-1 text-sm text-gray-600">
          Upload WSLL (Workstream Success Level) scores for the active cycle
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Upload CSV</h3>
        <p className="text-sm text-gray-600 mb-4">
          <strong>CSV Headers:</strong> <span className="font-mono">Staff ID, WSLL Score, WSLL Date</span> (WSLL Date is optional)
        </p>

        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label htmlFor="wsll-upload-page-file-input" className="block text-sm font-medium text-gray-700 mb-2">Select CSV File</label>
            <input
              id="wsll-upload-page-file-input"
              type="file"
              accept=".csv"
              aria-label="Select CSV File"
              title="Select CSV File"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!uploadFile || loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Uploading..." : "Upload WSLL Scores"}
          </button>
        </form>
      </section>

      {uploadResult && (
        <section className="rounded-lg border border-green-200 bg-green-50 p-4">
          <h3 className="text-lg font-semibold text-green-900 mb-3">Upload Summary</h3>
          <div className="space-y-2 text-sm text-green-800">
            <p>
              <strong>Total Rows:</strong> {uploadResult.total}
            </p>
            <p>
              <strong>Imported:</strong> {uploadResult.imported}
            </p>
            <p>
              <strong>Flagged:</strong> {uploadResult.flagged}
            </p>
          </div>

          {uploadResult.questionableRows && uploadResult.questionableRows.length > 0 && (
            <div className="mt-4">
              <button
                onClick={downloadQuestionableCSV}
                className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
              >
                Download Questionable Rows CSV
              </button>

              <details className="mt-4">
                <summary className="text-sm font-medium text-green-900 cursor-pointer">
                  View Questionable Rows ({uploadResult.questionableRows.length})
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-green-300">
                      <tr>
                        {Object.keys(uploadResult.questionableRows[0]).map((key) => (
                          <th key={key} className="px-2 py-2 text-left font-medium text-green-900">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-200">
                      {uploadResult.questionableRows.map((row: any, idx: number) => (
                        <tr key={idx}>
                          {Object.values(row).map((val: any, vidx: number) => (
                            <td key={vidx} className="px-2 py-2 text-green-800">
                              {String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">WSLL Score Information</h3>
        <ul className="list-disc list-inside text-sm text-blue-800 space-y-1">
          <li>
            <strong>Acceptable score:</strong> 3.0 or higher
          </li>
          <li>
            <strong>WSLL &lt; 3.0:</strong> Case recommendation will be 0, and case cannot advance to Site Lead approval without exception request
          </li>
          <li>
            <strong>Missing WSLL:</strong> Case cannot advance to Site Lead approval
          </li>
          <li>Upload will upsert scores by (cycle ID, staff ID)</li>
        </ul>
      </section>
    </div>
  );
}
