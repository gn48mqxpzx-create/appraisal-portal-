import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

type CompCurrent = {
  baseSalary: number;
  fixedAllowances: number;
  variableAllowances: number;
  recurringBonuses: number;
  onetimeBonuses: number;
  totalComp: number;
};

type MarketSnapshot = {
  tenureMonthsUsed: number | null;
  benchmarkBaseUsed: number | null;
  catchupPercentUsed: number | null;
  wsllScoreUsed: number | null;
  wsllGateStatus: string;
  isWsllExceptionRequested: boolean;
  wsllExceptionNote: string | null;
};

type Recommendation = {
  varianceAmount: number;
  variancePercent: number | null;
  recommendedAmount: number;
  recommendedPercent: number | null;
  recommendedNewBase: number;
};

type Override = {
  overrideAmount: number | null;
  overridePercent: number | null;
  overrideNewBase: number | null;
  overrideReason: string;
};

type ApprovalWorkflow = {
  siteLeadStatus: string;
  siteLeadBy: string | null;
  siteLeadAt: string | null;
  siteLeadComment: string | null;
  clientStatus: string;
  clientBy: string | null;
  clientAt: string | null;
  clientComment: string | null;
};

type ApprovalEvidence = {
  id: string;
  type: string;
  filePath: string | null;
  linkUrl: string | null;
  uploadedBy: string;
  uploadedAt: string;
};

type PayrollProcessing = {
  effectivityDate: string | null;
  payrollStatus: string;
  processedBy: string | null;
  processedAt: string | null;
};

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
const VIEWER_ROLE_KEY = "cases_viewer_role";

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<CaseDetail | null>(null);
    const [compData, setCompData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract viewer params from URL query params (from "Open" link)
  const viewerRole = searchParams.get("viewerRole") || localStorage.getItem(VIEWER_ROLE_KEY) || "ADMIN";
  const viewerName = searchParams.get("viewerName") || "";
  // Form states for current compensation
  const [baseSalary, setBaseSalary] = useState<string>("");
  const [fixedAllowances, setFixedAllowances] = useState<string>("");
  const [variableAllowances, setVariableAllowances] = useState<string>("");
  const [recurringBonuses, setRecurringBonuses] = useState<string>("");
  const [onetimeBonuses, setOnetimeBonuses] = useState<string>("");

  // WSLL exception
  const [wsllExceptionRequested, setWsllExceptionRequested] = useState(false);
  const [wsllExceptionNote, setWsllExceptionNote] = useState("");

  // Override states
  const [overrideAmount, setOverrideAmount] = useState<string>("");
  const [overridePercent, setOverridePercent] = useState<string>("");
  const [overrideNewBase, setOverrideNewBase] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");

  // Approval states
  const [siteLeadComment, setSiteLeadComment] = useState<string>("");
  const [clientComment, setClientComment] = useState<string>("");
  const [hubspotLink, setHubspotLink] = useState<string>("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  // Payroll states
  const [effectivityDate, setEffectivityDate] = useState<string>("");


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

  // Load compensation data
  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const loadComp = async () => {
      try {
        const res = await fetch(`${API_BASE}/cases/${id}/compensation`);
        const json = await res.json();

        if (!cancelled && json.success) {
          setCompData(json.data);

          // Initialize form values
          if (json.data.compCurrent) {
            setBaseSalary(String(json.data.compCurrent.baseSalary || ""));
            setFixedAllowances(String(json.data.compCurrent.fixedAllowances || ""));
            setVariableAllowances(String(json.data.compCurrent.variableAllowances || ""));
            setRecurringBonuses(String(json.data.compCurrent.recurringBonuses || ""));
            setOnetimeBonuses(String(json.data.compCurrent.onetimeBonuses || ""));
          }

          if (json.data.marketSnapshot) {
            setWsllExceptionRequested(json.data.marketSnapshot.isWsllExceptionRequested || false);
            setWsllExceptionNote(json.data.marketSnapshot.wsllExceptionNote || "");
          }

          if (json.data.override) {
            setOverrideAmount(String(json.data.override.overrideAmount || ""));
            setOverridePercent(String(json.data.override.overridePercent || ""));
            setOverrideNewBase(String(json.data.override.overrideNewBase || ""));
            setOverrideReason(json.data.override.overrideReason || "");
          }

          if (json.data.payrollProcessing?.effectivityDate) {
            const dateStr = new Date(json.data.payrollProcessing.effectivityDate).toISOString().split("T")[0];
            setEffectivityDate(dateStr);
          }
        }
      } catch (e: any) {
        console.error("Failed to load compensation data", e);
      }
    };

    loadComp();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const refreshCompData = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/compensation`);
      const json = await res.json();
      if (json.success) {
        setCompData(json.data);
      }
    } catch (e) {
      console.error("Failed to refresh compensation data", e);
    }
  };

  const handleSaveCurrentComp = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/compensation/current`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseSalary: parseFloat(baseSalary) || 0,
          fixedAllowances: parseFloat(fixedAllowances) || 0,
          variableAllowances: parseFloat(variableAllowances) || 0,
          recurringBonuses: parseFloat(recurringBonuses) || 0,
          onetimeBonuses: parseFloat(onetimeBonuses) || 0,
          updatedBy: "temp-user",
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Current compensation saved");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to save");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRecompute = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/recommendation/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ computedBy: "temp-user" }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Recommendation recomputed");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to recompute");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSaveOverride = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrideAmount: overrideAmount ? parseFloat(overrideAmount) : null,
          overridePercent: overridePercent ? parseFloat(overridePercent) : null,
          overrideNewBase: overrideNewBase ? parseFloat(overrideNewBase) : null,
          overrideReason,
          overriddenBy: "temp-user",
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Override saved");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to save override");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSaveWsllException = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/wsll-exception`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isWsllExceptionRequested: wsllExceptionRequested,
          wsllExceptionNote,
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert("WSLL exception request saved");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to save");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSendToSiteLead = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/send-to-site-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const json = await res.json();
      if (json.success) {
        alert("Sent to Site Lead for approval");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to send");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSiteLeadApprove = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/site-lead/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: "temp-admin", comment: siteLeadComment }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Site Lead Approved");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to approve");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSiteLeadReject = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/site-lead/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectedBy: "temp-admin", comment: siteLeadComment }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Site Lead Rejected - case returned to DRAFT");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to reject");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSecureClientApproval = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/secure-client-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createdBy: "temp-user" }),
      });

      const json = await res.json();
      if (json.success) {
        window.open(json.data.mailtoUrl, "_blank");
        alert("Client approval email drafted. Case status updated to CLIENT_PENDING.");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to secure client approval");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleUploadEvidence = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!evidenceFile && !hubspotLink) {
      alert("Please provide either a PDF file or a HubSpot link");
      return;
    }

    try {
      let res;

      if (evidenceFile) {
        const formData = new FormData();
        formData.append("file", evidenceFile);
        formData.append("uploadedBy", "temp-user");

        res = await fetch(`${API_BASE}/cases/${id}/client-approval/evidence`, {
          method: "POST",
          body: formData,
        });
      } else if (hubspotLink) {
        res = await fetch(`${API_BASE}/cases/${id}/client-approval/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubspotLink, uploadedBy: "temp-user" }),
        });
      }

      if (!res) {
        alert("Please provide either a file or a HubSpot link");
        return;
      }

      const json = await res.json();
      if (json.success) {
        alert("Evidence uploaded");
        setEvidenceFile(null);
        setHubspotLink("");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to upload evidence");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleClientApprove = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/client-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: "temp-user", comment: clientComment }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Client Approved - case moved to PAYROLL_PENDING");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to mark client approved");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSaveEffectivityDate = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/payroll/effectivity-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectivityDate }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Effectivity date saved");
        refreshCompData();
      } else {
        alert(json.error?.message || "Failed to save effectivity date");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handlePayrollProcess = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/payroll/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processedBy: "temp-user" }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Payroll Processed");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to process payroll");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleLockCase = async () => {
    try {
      const res = await fetch(`${API_BASE}/cases/${id}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockedBy: "temp-admin" }),
      });

      const json = await res.json();
      if (json.success) {
        alert("Case Locked");
        window.location.reload();
      } else {
        alert(json.error?.message || "Failed to lock case");
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const computeFinalNewBase = () => {
    const currentBase = parseFloat(baseSalary) || 0;
    const recNewBase = compData?.recommendation?.recommendedNewBase || currentBase;

    if (overrideNewBase) return parseFloat(overrideNewBase);
    if (overrideAmount) return currentBase + parseFloat(overrideAmount);
    if (overridePercent) return currentBase * (1 + parseFloat(overridePercent) / 100);
    return recNewBase;
  };

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
          {/* WSLL + Eligibility */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">WSLL + Eligibility</h3>
            {compData?.marketSnapshot ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">WSLL Score</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      {compData.marketSnapshot.wsllScoreUsed !== null ? compData.marketSnapshot.wsllScoreUsed : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gate Status</div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          compData.marketSnapshot.wsllGateStatus === "PASS"
                            ? "bg-green-100 text-green-800"
                            : compData.marketSnapshot.wsllGateStatus === "FAIL"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {compData.marketSnapshot.wsllGateStatus}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Exception Requested</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      {compData.marketSnapshot.isWsllExceptionRequested ? "Yes" : "No"}
                    </div>
                  </div>
                </div>

                {compData.marketSnapshot.wsllGateStatus === "FAIL" && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-800">
                      <strong>Disqualified:</strong> WSLL score is below 3.0. System recommendation is 0. Cannot advance without client exception.
                    </p>
                  </div>
                )}

                {compData.marketSnapshot.wsllGateStatus === "MISSING" && (
                  <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3">
                    <p className="text-sm text-yellow-800">
                      <strong>Missing WSLL:</strong> Cannot send to Site Lead approval until WSLL score is uploaded.
                    </p>
                  </div>
                )}

                {data?.status === "DRAFT" && compData.marketSnapshot.wsllGateStatus === "FAIL" && (
                  <div className="space-y-3">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={wsllExceptionRequested}
                        onChange={(e) => setWsllExceptionRequested(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-700">Request WSLL Exception</span>
                    </label>
                    {wsllExceptionRequested && (
                      <>
                        <textarea
                          value={wsllExceptionNote}
                          onChange={(e) => setWsllExceptionNote(e.target.value)}
                          placeholder="Provide a note explaining why the exception is warranted..."
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          rows={3}
                        />
                        <button
                          onClick={handleSaveWsllException}
                          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          Save Exception Request
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No WSLL data available yet.</p>
            )}
          </section>

          {/* Current Compensation */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Compensation</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="baseSalary" className="block text-sm font-medium text-gray-700 mb-1">Base Salary</label>
                <input
                  id="baseSalary"
                  type="number"
                  step="0.01"
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="fixedAllowances" className="block text-sm font-medium text-gray-700 mb-1">Fixed Allowances</label>
                <input
                  id="fixedAllowances"
                  type="number"
                  step="0.01"
                  value={fixedAllowances}
                  onChange={(e) => setFixedAllowances(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="variableAllowances" className="block text-sm font-medium text-gray-700 mb-1">Variable Allowances</label>
                <input
                  id="variableAllowances"
                  type="number"
                  step="0.01"
                  value={variableAllowances}
                  onChange={(e) => setVariableAllowances(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="recurringBonuses" className="block text-sm font-medium text-gray-700 mb-1">Recurring Bonuses</label>
                <input
                  id="recurringBonuses"
                  type="number"
                  step="0.01"
                  value={recurringBonuses}
                  onChange={(e) => setRecurringBonuses(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="onetimeBonuses" className="block text-sm font-medium text-gray-700 mb-1">One-time Bonuses</label>
                <input
                  id="onetimeBonuses"
                  type="number"
                  step="0.01"
                  value={onetimeBonuses}
                  onChange={(e) => setOnetimeBonuses(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Comp</label>
                <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
                  $
                  {(
                    (parseFloat(baseSalary) || 0) +
                    (parseFloat(fixedAllowances) || 0) +
                    (parseFloat(variableAllowances) || 0) +
                    (parseFloat(recurringBonuses) || 0) +
                    (parseFloat(onetimeBonuses) || 0)
                  ).toFixed(2)}
                </div>
              </div>
            </div>
            <button
              onClick={handleSaveCurrentComp}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save Current Compensation
            </button>
          </section>

          {/* Market + Recommendation */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Market + Recommendation</h3>
            {compData?.marketSnapshot && compData?.recommendation ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tenure (Months)</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      {compData.marketSnapshot.tenureMonthsUsed ?? "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Benchmark Base</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      {compData.marketSnapshot.benchmarkBaseUsed
                        ? `$${Number(compData.marketSnapshot.benchmarkBaseUsed).toFixed(2)}`
                        : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Catchup %</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      {compData.marketSnapshot.catchupPercentUsed ?? "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Variance</div>
                    <div className="mt-1 text-base font-medium text-gray-900">
                      ${Number(compData.recommendation.varianceAmount || 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 border-t border-gray-200 pt-4">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommended Amount</div>
                    <div className="mt-1 text-base font-medium text-blue-600">
                      ${Number(compData.recommendation.recommendedAmount || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommended %</div>
                    <div className="mt-1 text-base font-medium text-blue-600">
                      {compData.recommendation.recommendedPercent
                        ? `${(Number(compData.recommendation.recommendedPercent) * 100).toFixed(2)}%`
                        : "0%"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recommended New Base</div>
                    <div className="mt-1 text-base font-medium text-blue-600">
                      ${Number(compData.recommendation.recommendedNewBase || 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleRecompute}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  Recompute Recommendation
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-3">No recommendation computed yet.</p>
                <button
                  onClick={handleRecompute}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  Compute Recommendation
                </button>
              </div>
            )}
          </section>

          {/* Override */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Override</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="overrideAmount" className="block text-sm font-medium text-gray-700 mb-1">Override Amount ($)</label>
                  <input
                    id="overrideAmount"
                    type="number"
                    step="0.01"
                    value={overrideAmount}
                    onChange={(e) => setOverrideAmount(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="overridePercent" className="block text-sm font-medium text-gray-700 mb-1">Override Percent (%)</label>
                  <input
                    id="overridePercent"
                    type="number"
                    step="0.01"
                    value={overridePercent}
                    onChange={(e) => setOverridePercent(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="overrideNewBase" className="block text-sm font-medium text-gray-700 mb-1">Override New Base ($)</label>
                  <input
                    id="overrideNewBase"
                    type="number"
                    step="0.01"
                    value={overrideNewBase}
                    onChange={(e) => setOverrideNewBase(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Override Reason (required if overriding)</label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain the reason for this override..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                />
              </div>
              <div className="border-t border-gray-200 pt-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Final New Base Preview</div>
                <div className="text-2xl font-bold text-green-600">${computeFinalNewBase().toFixed(2)}</div>
              </div>
              <button
                onClick={handleSaveOverride}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save Override
              </button>
            </div>
          </section>

          {/* Approval Workflow Actions */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Approval Workflow</h3>
            <div className="space-y-4">
              {data?.status === "DRAFT" && (
                <button
                  onClick={handleSendToSiteLead}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Send to Site Lead
                </button>
              )}

              {data?.status === "SITE_LEAD_PENDING" && viewerRole === "ADMIN" && (
                <div className="space-y-3">
                  <textarea
                    value={siteLeadComment}
                    onChange={(e) => setSiteLeadComment(e.target.value)}
                    placeholder="Comment (optional)"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={handleSiteLeadApprove}
                      className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      Site Lead Approve
                    </button>
                    <button
                      onClick={handleSiteLeadReject}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Site Lead Reject
                    </button>
                  </div>
                </div>
              )}

              {data?.status === "SITE_LEAD_APPROVED" && (
                <button
                  onClick={handleSecureClientApproval}
                  className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
                >
                  Secure Client Approval (Draft Email)
                </button>
              )}

              {data?.status === "CLIENT_PENDING" && (
                <div className="space-y-4">
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                    <p className="text-sm text-blue-800">
                      <strong>Client Pending:</strong> Upload approval evidence (PDF or HubSpot link) before marking as approved.
                    </p>
                  </div>

                  <form onSubmit={handleUploadEvidence} className="space-y-3">
                    <div>
                      <label htmlFor="evidenceFile" className="block text-sm font-medium text-gray-700 mb-1">Upload PDF Evidence</label>
                      <input
                        id="evidenceFile"
                        type="file"
                        accept=".pdf"
                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="text-center text-sm text-gray-500">OR</div>
                    <div>
                      <label htmlFor="hubspotLink" className="block text-sm font-medium text-gray-700 mb-1">HubSpot Link</label>
                      <input
                        id="hubspotLink"
                        type="url"
                        value={hubspotLink}
                        onChange={(e) => setHubspotLink(e.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Upload Evidence
                    </button>
                  </form>

                  {compData?.approvalEvidence && compData.approvalEvidence.length > 0 && (
                    <div className="border-t border-gray-200 pt-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">Evidence List</h4>
                      <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                        {compData.approvalEvidence.map((ev: ApprovalEvidence) => (
                          <li key={ev.id}>
                            {ev.type} - {ev.filePath || ev.linkUrl} (by {ev.uploadedBy})
                          </li>
                        ))}
                      </ul>

                      <div className="mt-4">
                        <textarea
                          value={clientComment}
                          onChange={(e) => setClientComment(e.target.value)}
                          placeholder="Client comment (optional)"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          rows={2}
                        />
                        <button
                          onClick={handleClientApprove}
                          className="mt-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                        >
                          Mark Client Approved
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {data?.status === "PAYROLL_PENDING" && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="effectivityDate" className="block text-sm font-medium text-gray-700 mb-1">Effectivity Date (required)</label>
                    <input
                      id="effectivityDate"
                      type="date"
                      value={effectivityDate}
                      onChange={(e) => setEffectivityDate(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={handleSaveEffectivityDate}
                      className="mt-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Save Effectivity Date
                    </button>
                  </div>
                  {effectivityDate && (
                    <button
                      onClick={handlePayrollProcess}
                      className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      Mark Payroll Processed
                    </button>
                  )}
                </div>
              )}

              {data?.status === "PAYROLL_PROCESSED" && viewerRole === "ADMIN" && (
                <button
                  onClick={handleLockCase}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Lock Case
                </button>
              )}

              {data?.status === "LOCKED" && (
                <div className="rounded-md bg-gray-100 border border-gray-300 p-3">
                  <p className="text-sm text-gray-700">
                    <strong>Case Locked:</strong> No further changes allowed.
                  </p>
                </div>
              )}
            </div>
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