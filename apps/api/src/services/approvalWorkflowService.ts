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
      status: "SUBMITTED_FOR_REVIEW",
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
      status: "REVIEW_APPROVED",
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
      status: "REVIEW_REJECTED",
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

  if (caseRecord.status !== "REVIEW_APPROVED") {
    throw new Error("Case must be review approved to secure client approval");
  }

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
      status: "PENDING_CLIENT_APPROVAL",
    },
  });

  return { success: true, createdBy };
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

  if (caseRecord.status !== "PENDING_CLIENT_APPROVAL") {
    throw new Error("Case must be in PENDING_CLIENT_APPROVAL status");
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

  await prisma.appraisalCase.update({
    where: { id: caseId },
    data: {
      status: "CLIENT_APPROVED",
    },
  });

  return { success: true };
}
