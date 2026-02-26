import { ChangeEvent, useMemo, useState } from "react";

type IntakeUploadResponse = {
  total: number;
  imported: number;
  flagged: number;
  errors: number;
  reportUrl: string;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function IntakeUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [summary, setSummary] = useState<IntakeUploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reportDownloadUrl = useMemo(() => {
    if (!summary?.reportUrl) {
      return "";
    }

    if (summary.reportUrl.startsWith("http://") || summary.reportUrl.startsWith("https://")) {
      return summary.reportUrl;
    }

    return `${API_BASE}${summary.reportUrl}`;
  }, [summary]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSummary(null);
    setError(null);
    setProgress(0);
    setFile(event.target.files?.[0] ?? null);
  };

  const onUpload = async () => {
    if (!file || isUploading) {
      return;
    }

    setIsUploading(true);
    setError(null);
    setSummary(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/intake/upload`, true);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        setProgress(Math.round((event.loaded / event.total) * 100));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const payload = JSON.parse(xhr.responseText) as IntakeUploadResponse;
          setSummary(payload);
          setProgress(100);
        } else {
          try {
            const payload = JSON.parse(xhr.responseText) as {
              error?: { message?: string };
            };
            setError(payload.error?.message ?? "Upload failed.");
          } catch {
            setError("Upload failed.");
          }
        }

        setIsUploading(false);
        resolve();
      };

      xhr.onerror = () => {
        setError("Network error while uploading CSV.");
        setIsUploading(false);
        resolve();
      };

      xhr.send(formData);
    });
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold text-gray-900">Employee Intake Upload</h2>
        <p className="mt-1 text-sm text-gray-600">Upload CSV to define who exists and who is in appraisal scope.</p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <label htmlFor="intake-upload-file" className="mb-2 block text-sm font-medium text-gray-700">
            Upload CSV file
          </label>
          <input
            id="intake-upload-file"
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-md file:border-0 file:bg-primary-100 file:px-4 file:py-2 file:text-primary-700"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onUpload}
            disabled={!file || isUploading}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : "Upload"}
          </button>
          <span className="text-sm text-gray-600">Progress: {progress}%</span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

      {summary ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-lg font-medium text-gray-900">Upload Summary</h3>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-gray-500">Total rows</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{summary.total}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Imported</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{summary.imported}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Flagged</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{summary.flagged}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Errors</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{summary.errors}</dd>
            </div>
          </dl>

          <div className="mt-4">
            <a
              href={reportDownloadUrl}
              className="inline-flex rounded-md border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
            >
              Download questionable rows CSV
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
