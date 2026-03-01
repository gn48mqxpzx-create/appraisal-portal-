import { PrismaClient, ApprovalWorkflowStatus, WsllGateStatus } from "@prisma/client";

const prisma = new PrismaClient();

export async function sendToSiteLead(caseId: string) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      marketSnapshot: true,
    },
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  const marketSnapshot = caseRecord.marketSnapshot;

  // Check WSLL gate
  if (!marketSnapshot || marketSnapshot.wsllGateStatus === WsllGateStatus.MISSING) {
    throw new Error("Cannot send to Site Lead: WSLL score is missing");
  }

  if (
    marketSnapshot.wsllGateStatus === WsllGateStatus.FAIL &&
    !marketSnapshot.isWsllExceptionRequested
  ) {
    throw new Error(
      "Cannot send to Site Lead: WSLL score is below 3.0. Please request WSLL exception with a note."
    );
  }

  if (
    marketSnapshot.wsllGateStatus === WsllGateStatus.FAIL &&
    marketSnapshot.isWsllExceptionRequested &&
    !marketSnapshot.wsllExceptionNote
  ) {
    throw new Error("Cannot send to Site Lead: WSLL exception note is required");
  }

  // Create or update approval workflow
  await prisma.caseApprovalWorkflow.upsert({
    where: { caseId },
    create: {
      caseId,
      siteLeadStatus: ApprovalWorkflowStatus.PENDING,
    },
    update: {
      siteLeadStatus: ApprovalWorkflowStatus.PENDING,
    },
  });

  // Update case status
  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "SITE_LEAD_PENDING",
    },
  });

  return { success: true };
}

export async function siteLeadApprove(
  caseId: string,
  approvedBy: string,
  comment?: string
) {
  await prisma.caseApprovalWorkflow.upsert({
    where: { caseId },
    create: {
      caseId,
      siteLeadStatus: ApprovalWorkflowStatus.APPROVED,
      siteLeadBy: approvedBy,
      siteLeadAt: new Date(),
      siteLeadComment: comment,
    },
    update: {
      siteLeadStatus: ApprovalWorkflowStatus.APPROVED,
      siteLeadBy: approvedBy,
      siteLeadAt: new Date(),
      siteLeadComment: comment,
    },
  });

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "SITE_LEAD_APPROVED",
    },
  });

  return { success: true };
}

export async function siteLeadReject(
  caseId: string,
  rejectedBy: string,
  comment?: string
) {
  await prisma.caseApprovalWorkflow.upsert({
    where: { caseId },
    create: {
      caseId,
      siteLeadStatus: ApprovalWorkflowStatus.REJECTED,
      siteLeadBy: rejectedBy,
      siteLeadAt: new Date(),
      siteLeadComment: comment,
    },
    update: {
      siteLeadStatus: ApprovalWorkflowStatus.REJECTED,
      siteLeadBy: rejectedBy,
      siteLeadAt: new Date(),
      siteLeadComment: comment,
    },
  });

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "DRAFT",
    },
  });

  return { success: true };
}

export async function secureClientApproval(caseId: string, createdBy: string) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      compCurrent: true,
      recommendation: true,
      override: true,
      marketSnapshot: true,
      payrollProcessing: true,
    },
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (caseRecord.status !== "SITE_LEAD_APPROVED") {
    throw new Error("Case must be Site Lead Approved to secure client approval");
  }

  const currentBase = caseRecord.compCurrent?.baseSalary || 0;
  const benchmarkBase = caseRecord.marketSnapshot?.benchmarkBaseUsed || 0;
  const recommendedNewBase = caseRecord.recommendation?.recommendedNewBase || currentBase;
  const overrideNewBase = caseRecord.override?.overrideNewBase;
  const effectivityDate = caseRecord.payrollProcessing?.effectivityDate || "TBD";

  const finalNewBase = overrideNewBase || recommendedNewBase;

  const subject = `Salary Review Approval Required - ${caseRecord.staffId} ${caseRecord.fullName} (${caseRecord.staffRole})`;
  const body = `Dear Client,

We are seeking your approval for the following salary adjustment:

Employee: ${caseRecord.fullName}
Staff ID: ${caseRecord.staffId}
Role: ${caseRecord.staffRole}
Company: ${caseRecord.companyName}

Current Base Salary: $${Number(currentBase).toFixed(2)}
Market Benchmark: $${Number(benchmarkBase).toFixed(2)}
Recommended New Base: $${Number(recommendedNewBase).toFixed(2)}
${overrideNewBase ? `Override New Base: $${Number(overrideNewBase).toFixed(2)}` : ""}
Final Proposed Base: $${Number(finalNewBase).toFixed(2)}

Proposed Effectivity Date: ${effectivityDate}

Please review and approve this adjustment.

Thank you.`;

  // Store email event
  await prisma.caseEmailEvent.create({
    data: {
      caseId,
      eventType: "CLIENT_APPROVAL_DRAFTED",
      subject,
      body,
      createdBy,
    },
  });

  // Update approval workflow
  await prisma.caseApprovalWorkflow.upsert({
    where: { caseId },
    create: {
      caseId,
      clientStatus: ApprovalWorkflowStatus.PENDING,
    },
    update: {
      clientStatus: ApprovalWorkflowStatus.PENDING,
    },
  });

  // Update case status
  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "CLIENT_PENDING",
    },
  });

  const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { mailtoUrl, subject, body };
}

export async function clientApprove(caseId: string, approvedBy: string, comment?: string) {
  const caseRecord = await prisma.appraisalCase.findUnique({
    where: { id: caseId },
    include: {
      approvalEvidence: true,
      marketSnapshot: true,
      override: true,
    },
  });

  if (!caseRecord) {
    throw new Error("Case not found");
  }

  if (caseRecord.status !== "CLIENT_PENDING") {
    throw new Error("Case must be in CLIENT_PENDING status");
  }

  // Check that evidence exists
  if (!caseRecord.approvalEvidence || caseRecord.approvalEvidence.length === 0) {
    throw new Error("Cannot approve: At least one approval evidence (PDF or HubSpot link) is required");
  }

  // If WSLL < 3.0, require override with reason referencing client exception
  if (
    caseRecord.marketSnapshot?.wsllGateStatus === WsllGateStatus.FAIL &&
    (!caseRecord.override || !caseRecord.override.overrideReason)
  ) {
    throw new Error(
      "Cannot approve: WSLL < 3.0 requires an override with reason referencing client exception"
    );
  }

  await prisma.caseApprovalWorkflow.upsert({
    where: { caseId },
    create: {
      caseId,
      clientStatus: ApprovalWorkflowStatus.APPROVED,
      clientBy: approvedBy,
      clientAt: new Date(),
      clientComment: comment,
    },
    update: {
      clientStatus: ApprovalWorkflowStatus.APPROVED,
      clientBy: approvedBy,
      clientAt: new Date(),
      clientComment: comment,
    },
  });

  // Update case status to CLIENT_APPROVED then immediately to PAYROLL_PENDING
  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "PAYROLL_PENDING",
    },
  });

  // Ensure payroll processing record exists
  await prisma.payrollProcessing.upsert({
    where: { caseId },
    create: {
      caseId,
      payrollStatus: "PENDING",
    },
    update: {},
  });

  return { success: true };
}
