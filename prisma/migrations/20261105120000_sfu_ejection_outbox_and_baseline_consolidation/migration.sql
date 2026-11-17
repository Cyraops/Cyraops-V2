-- Migration: 20261105120000_sfu_ejection_outbox_and_baseline_consolidation
-- Purpose: Canonical consolidation migration for SFU Ejection Transactional Outbox (CallSfuEjectionJob)
-- and all baseline enterprise models (CRM, AI, Email, Expenses).
-- Design: Idempotent DDL using IF NOT EXISTS and duplicate_object exception handlers for safe replay.

DO $$ BEGIN
  CREATE TYPE "OutboxJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DealStage" AS ENUM ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContactStatus" AS ENUM ('LEAD', 'CUSTOMER', 'PARTNER', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AiTaskStatus" AS ENUM ('CREATED', 'PLANNING', 'AWAITING_APPROVAL', 'READY', 'RUNNING', 'WAITING_FOR_AGENT', 'WAITING_FOR_EXTERNAL_RESULT', 'PAUSED', 'RECOVERING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiskClass" AS ENUM ('CLASS_A', 'CLASS_B', 'CLASS_C');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "MemoryType" AS ENUM ('CONVERSATION', 'AGENT', 'USER', 'COMPANY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailFolderType" AS ENUM ('INBOX', 'SENT', 'DRAFTS', 'STARRED', 'ARCHIVE', 'SPAM', 'TRASH', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpensePaymentMethod" AS ENUM ('BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'PAYPAL', 'CASH', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpensePaymentStatus" AS ENUM ('PAID', 'PENDING', 'SCHEDULED', 'REIMBURSEMENT_PENDING', 'REFUNDED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpenseClassification" AS ENUM ('OPEX', 'CAPEX', 'REIMBURSEMENT', 'REFUND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'VERIFIED', 'REJECTED', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestmentType" AS ENUM ('FOUNDER_CAPITAL', 'ANGEL_INVESTMENT', 'EQUIPMENT', 'IP_SOFTWARE', 'LOAN', 'GRANT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvestorType" AS ENUM ('FOUNDER', 'INVESTOR', 'PARTNER', 'INSTITUTION', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingCycle" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AIProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'GOOGLE', 'COHERE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "MarketingPlatform" AS ENUM ('GOOGLE_ADS', 'META_ADS', 'LINKEDIN_ADS', 'UPWORK', 'TWITTER_X', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "MarketingCampaignType" AS ENUM ('SEARCH_ADS', 'DISPLAY_ADS', 'SOCIAL_ADS', 'UPWORK_BIDDING', 'UPWORK_CONNECTS', 'OUTREACH', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'UPLOAD', 'EXPORT', 'VERIFY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CostAuditEntity" AS ENUM ('EXPENSE', 'INVOICE', 'INVESTMENT', 'RECURRING', 'AI_USAGE', 'MARKETING', 'CATEGORY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CallParticipant" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CallSession" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CallSfuEjectionJob" (
    "id" TEXT NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OutboxJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CallSfuEjectionJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'LEAD',
    "companyId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contactId" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "assignedToId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Deal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stage" "DealStage" NOT NULL DEFAULT 'DISCOVERY',
    "probability" INTEGER NOT NULL DEFAULT 20,
    "expectedCloseDate" TIMESTAMP(3),
    "companyId" TEXT,
    "contactId" TEXT,
    "ownerId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiAgent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "modelProfile" TEXT NOT NULL DEFAULT 'reasoning',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "tools" TEXT NOT NULL DEFAULT '[]',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiTask" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "objective" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "assignedAgentId" TEXT NOT NULL,
    "requestingUserId" TEXT NOT NULL,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'CREATED',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "plan" TEXT NOT NULL DEFAULT '[]',
    "result" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT,
    "workerId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastHeartbeat" TIMESTAMP(3),
    "recoveryMetadata" TEXT,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 1,
    "conversationId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiTaskStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "assignedAgentSlug" TEXT,
    "status" "AiTaskStatus" NOT NULL DEFAULT 'CREATED',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT,
    "error" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiApproval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepIndex" INTEGER,
    "proposedAction" TEXT NOT NULL,
    "riskClass" "RiskClass" NOT NULL DEFAULT 'CLASS_B',
    "description" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiToolCall" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT,
    "toolId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "error" TEXT,
    "riskClass" "RiskClass" NOT NULL DEFAULT 'CLASS_A',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "executionTimeMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiConversation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Conversation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "reasoning" TEXT,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiSkill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "requiredTools" TEXT NOT NULL DEFAULT '[]',
    "inputSchema" TEXT NOT NULL DEFAULT '{}',
    "outputSchema" TEXT NOT NULL DEFAULT '{}',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isCompanyShared" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiRoutine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cronExpression" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRoutine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiMemory" (
    "id" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL DEFAULT 'COMPANY',
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "userId" TEXT,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiUsageLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "agentSlug" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiAuditLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "details" TEXT NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TeamSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "level" TEXT NOT NULL DEFAULT 'INTERMEDIATE',
    "yearsExperience" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "evidenceUrl" TEXT,
    "deliveryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Certification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "credentialId" TEXT,
    "credentialUrl" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServiceCapability" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Cloud & Infrastructure',
    "description" TEXT NOT NULL DEFAULT '',
    "requiredExpertise" TEXT NOT NULL DEFAULT '',
    "minRequiredEngineers" INTEGER NOT NULL DEFAULT 1,
    "deliveryReadiness" TEXT NOT NULL DEFAULT 'NOT_READY',
    "verifiedProjectsCount" INTEGER NOT NULL DEFAULT 0,
    "portfolioEvidence" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectFitAssessment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "projectName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "serviceCategory" TEXT NOT NULL,
    "estimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recommendation" TEXT NOT NULL DEFAULT 'AMBER',
    "technicalFitScore" INTEGER NOT NULL DEFAULT 0,
    "deliveryRisk" TEXT NOT NULL DEFAULT 'MEDIUM',
    "estimatedMarginPercent" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "timelineFeasible" BOOLEAN NOT NULL DEFAULT true,
    "clientBudget" DOUBLE PRECISION,
    "missingCapabilities" TEXT NOT NULL DEFAULT '[]',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFitAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BusinessWeakness" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "evidence" TEXT NOT NULL,
    "businessImpact" TEXT NOT NULL,
    "opportunitiesAffected" TEXT NOT NULL DEFAULT '[]',
    "recommendedAction" TEXT NOT NULL,
    "suggestedOwner" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'HIGH',
    "targetDate" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWeakness_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BusinessImprovement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "businessReason" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "estimatedEffort" TEXT NOT NULL DEFAULT '2-4 weeks',
    "requiredResources" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'HIGH',
    "ownerId" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "convertedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessImprovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT 'main',
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL DEFAULT 'imap.secureserver.net',
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapTls" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL DEFAULT 'smtpout.secureserver.net',
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpTls" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailFolder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rawPath" TEXT NOT NULL,
    "type" "EmailFolderType" NOT NULL DEFAULT 'CUSTOM',
    "specialUse" TEXT,
    "uidValidity" TEXT,
    "lastUid" INTEGER,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "folderId" TEXT,
    "messageId" TEXT,
    "threadId" TEXT,
    "uid" INTEGER,
    "remoteUid" INTEGER,
    "idempotencyKey" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT',
    "imapAppendStatus" TEXT,
    "smtpResponse" TEXT,
    "lastError" TEXT,
    "sentAttempts" INTEGER NOT NULL DEFAULT 0,
    "fromName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "toRecipients" TEXT NOT NULL,
    "ccRecipients" TEXT,
    "bccRecipients" TEXT,
    "subject" TEXT NOT NULL DEFAULT '(No Subject)',
    "snippet" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "contentId" TEXT,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailSyncState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "uidValidity" TEXT,
    "highestUid" INTEGER,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT DEFAULT 'Tag',
    "color" TEXT DEFAULT '#64748b',
    "parentId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "exchangeRateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exchangeRateSource" TEXT NOT NULL DEFAULT 'SYSTEM_BASELINE',
    "amountBase" DOUBLE PRECISION NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "classification" "ExpenseClassification" NOT NULL DEFAULT 'OPEX',
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "paymentMethod" "ExpensePaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'PAID',
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringExpenseId" TEXT,
    "recurringPeriodKey" TEXT,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExpenseAttachment" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceRecord" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT,
    "vendor" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
    "fileHash" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "extractedData" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Investment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "investorName" TEXT NOT NULL,
    "investorType" "InvestorType" NOT NULL DEFAULT 'FOUNDER',
    "type" "InvestmentType" NOT NULL DEFAULT 'FOUNDER_CAPITAL',
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "exchangeRateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exchangeRateSource" TEXT NOT NULL DEFAULT 'SYSTEM_BASELINE',
    "amountBase" DOUBLE PRECISION NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "equityPercentage" DOUBLE PRECISION,
    "notes" TEXT,
    "referenceNumber" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecurringExpense" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "exchangeRateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exchangeRateSource" TEXT NOT NULL DEFAULT 'SYSTEM_BASELINE',
    "amountBase" DOUBLE PRECISION NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "categoryId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentMethod" "ExpensePaymentMethod" NOT NULL DEFAULT 'CREDIT_CARD',
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIUsageRecord" (
    "id" TEXT NOT NULL,
    "provider" "AIProvider" NOT NULL DEFAULT 'DEEPSEEK',
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 86.5,
    "exchangeRateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exchangeRateSource" TEXT NOT NULL DEFAULT 'SYSTEM_BASELINE',
    "costAmountBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledExpenseId" TEXT,
    "usageDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billedPeriod" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "MarketingPlatform" NOT NULL DEFAULT 'GOOGLE_ADS',
    "campaignType" "MarketingCampaignType" NOT NULL DEFAULT 'SEARCH_ADS',
    "spentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "exchangeRateDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exchangeRateSource" TEXT NOT NULL DEFAULT 'SYSTEM_BASELINE',
    "spentAmountBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledExpenseId" TEXT,
    "leadsGenerated" INTEGER NOT NULL DEFAULT 0,
    "clientsAcquired" INTEGER NOT NULL DEFAULT 0,
    "revenueGenerated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "connectsUsed" INTEGER NOT NULL DEFAULT 0,
    "proposalsSent" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CostAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" "CostAuditAction" NOT NULL,
    "entityType" "CostAuditEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallSfuEjectionJob_status_nextRetryAt_idx" ON "CallSfuEjectionJob"("status", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "CallSfuEjectionJob_callSessionId_idx" ON "CallSfuEjectionJob"("callSessionId");

CREATE INDEX IF NOT EXISTS "CallSfuEjectionJob_userId_idx" ON "CallSfuEjectionJob"("userId");

CREATE INDEX IF NOT EXISTS "Company_name_idx" ON "Company"("name");

CREATE INDEX IF NOT EXISTS "Contact_email_idx" ON "Contact"("email");

CREATE INDEX IF NOT EXISTS "Contact_companyId_idx" ON "Contact"("companyId");

CREATE INDEX IF NOT EXISTS "Lead_status_score_idx" ON "Lead"("status", "score");

CREATE INDEX IF NOT EXISTS "Lead_assignedToId_idx" ON "Lead"("assignedToId");

CREATE INDEX IF NOT EXISTS "Deal_stage_idx" ON "Deal"("stage");

CREATE INDEX IF NOT EXISTS "Deal_ownerId_idx" ON "Deal"("ownerId");

CREATE UNIQUE INDEX IF NOT EXISTS "AiAgent_slug_key" ON "AiAgent"("slug");

CREATE UNIQUE INDEX IF NOT EXISTS "AiTask_idempotencyKey_key" ON "AiTask"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "AiTask_status_createdAt_idx" ON "AiTask"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "AiTask_status_leaseExpiresAt_idx" ON "AiTask"("status", "leaseExpiresAt");

CREATE INDEX IF NOT EXISTS "AiTask_requestingUserId_idx" ON "AiTask"("requestingUserId");

CREATE INDEX IF NOT EXISTS "AiTaskStep_taskId_status_idx" ON "AiTaskStep"("taskId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "AiTaskStep_taskId_stepIndex_key" ON "AiTaskStep"("taskId", "stepIndex");

CREATE INDEX IF NOT EXISTS "AiApproval_status_createdAt_idx" ON "AiApproval"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "AiToolCall_taskId_createdAt_idx" ON "AiToolCall"("taskId", "createdAt");

CREATE INDEX IF NOT EXISTS "AiToolCall_toolName_idx" ON "AiToolCall"("toolName");

CREATE INDEX IF NOT EXISTS "AiToolCall_idempotencyKey_idx" ON "AiToolCall"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AiSkill_slug_key" ON "AiSkill"("slug");

CREATE INDEX IF NOT EXISTS "AiSkill_slug_idx" ON "AiSkill"("slug");

CREATE INDEX IF NOT EXISTS "AiRoutine_isEnabled_nextRunAt_idx" ON "AiRoutine"("isEnabled", "nextRunAt");

CREATE INDEX IF NOT EXISTS "AiMemory_type_key_idx" ON "AiMemory"("type", "key");

CREATE INDEX IF NOT EXISTS "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

CREATE INDEX IF NOT EXISTS "AiAuditLog_eventType_createdAt_idx" ON "AiAuditLog"("eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "TeamSkill_userId_skillName_idx" ON "TeamSkill"("userId", "skillName");

CREATE INDEX IF NOT EXISTS "TeamSkill_category_verified_idx" ON "TeamSkill"("category", "verified");

CREATE INDEX IF NOT EXISTS "Certification_userId_name_idx" ON "Certification"("userId", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceCapability_name_key" ON "ServiceCapability"("name");

CREATE INDEX IF NOT EXISTS "ServiceCapability_category_deliveryReadiness_idx" ON "ServiceCapability"("category", "deliveryReadiness");

CREATE INDEX IF NOT EXISTS "ProjectFitAssessment_recommendation_status_idx" ON "ProjectFitAssessment"("recommendation", "status");

CREATE INDEX IF NOT EXISTS "ProjectFitAssessment_serviceCategory_idx" ON "ProjectFitAssessment"("serviceCategory");

CREATE INDEX IF NOT EXISTS "BusinessWeakness_category_severity_idx" ON "BusinessWeakness"("category", "severity");

CREATE INDEX IF NOT EXISTS "BusinessWeakness_resolved_idx" ON "BusinessWeakness"("resolved");

CREATE INDEX IF NOT EXISTS "BusinessImprovement_status_priority_idx" ON "BusinessImprovement"("status", "priority");

CREATE INDEX IF NOT EXISTS "EmailAccount_userId_idx" ON "EmailAccount"("userId");

CREATE INDEX IF NOT EXISTS "EmailAccount_workspaceId_idx" ON "EmailAccount"("workspaceId");

CREATE INDEX IF NOT EXISTS "EmailFolder_accountId_type_idx" ON "EmailFolder"("accountId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "EmailFolder_accountId_rawPath_key" ON "EmailFolder"("accountId", "rawPath");

CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_folderId_idx" ON "EmailMessage"("accountId", "folderId");

CREATE INDEX IF NOT EXISTS "EmailMessage_userId_idx" ON "EmailMessage"("userId");

CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_receivedAt_idx" ON "EmailMessage"("accountId", "receivedAt");

CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_isStarred_idx" ON "EmailMessage"("accountId", "isStarred");

CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_isRead_idx" ON "EmailMessage"("accountId", "isRead");

CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_uid_idx" ON "EmailMessage"("accountId", "uid");

CREATE INDEX IF NOT EXISTS "EmailAttachment_messageId_idx" ON "EmailAttachment"("messageId");

CREATE UNIQUE INDEX IF NOT EXISTS "EmailSyncState_accountId_folderName_key" ON "EmailSyncState"("accountId", "folderName");

CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseCategory_slug_key" ON "ExpenseCategory"("slug");

CREATE INDEX IF NOT EXISTS "ExpenseCategory_parentId_idx" ON "ExpenseCategory"("parentId");

CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx" ON "Expense"("categoryId");

CREATE INDEX IF NOT EXISTS "Expense_subcategoryId_idx" ON "Expense"("subcategoryId");

CREATE INDEX IF NOT EXISTS "Expense_userId_idx" ON "Expense"("userId");

CREATE INDEX IF NOT EXISTS "Expense_paymentDate_idx" ON "Expense"("paymentDate");

CREATE INDEX IF NOT EXISTS "Expense_paymentStatus_idx" ON "Expense"("paymentStatus");

CREATE INDEX IF NOT EXISTS "Expense_classification_idx" ON "Expense"("classification");

CREATE INDEX IF NOT EXISTS "Expense_vendor_idx" ON "Expense"("vendor");

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_recurringExpenseId_recurringPeriodKey_key" ON "Expense"("recurringExpenseId", "recurringPeriodKey");

CREATE INDEX IF NOT EXISTS "ExpenseAttachment_expenseId_idx" ON "ExpenseAttachment"("expenseId");

CREATE INDEX IF NOT EXISTS "InvoiceRecord_expenseId_idx" ON "InvoiceRecord"("expenseId");

CREATE INDEX IF NOT EXISTS "InvoiceRecord_vendor_invoiceNumber_idx" ON "InvoiceRecord"("vendor", "invoiceNumber");

CREATE INDEX IF NOT EXISTS "InvoiceRecord_fileHash_idx" ON "InvoiceRecord"("fileHash");

CREATE INDEX IF NOT EXISTS "InvoiceRecord_status_idx" ON "InvoiceRecord"("status");

CREATE INDEX IF NOT EXISTS "Investment_userId_idx" ON "Investment"("userId");

CREATE INDEX IF NOT EXISTS "Investment_investorType_idx" ON "Investment"("investorType");

CREATE INDEX IF NOT EXISTS "Investment_type_idx" ON "Investment"("type");

CREATE INDEX IF NOT EXISTS "Investment_date_idx" ON "Investment"("date");

CREATE INDEX IF NOT EXISTS "RecurringExpense_categoryId_idx" ON "RecurringExpense"("categoryId");

CREATE INDEX IF NOT EXISTS "RecurringExpense_userId_idx" ON "RecurringExpense"("userId");

CREATE INDEX IF NOT EXISTS "RecurringExpense_status_idx" ON "RecurringExpense"("status");

CREATE INDEX IF NOT EXISTS "RecurringExpense_nextDueDate_idx" ON "RecurringExpense"("nextDueDate");

CREATE INDEX IF NOT EXISTS "AIUsageRecord_provider_idx" ON "AIUsageRecord"("provider");

CREATE INDEX IF NOT EXISTS "AIUsageRecord_model_idx" ON "AIUsageRecord"("model");

CREATE INDEX IF NOT EXISTS "AIUsageRecord_usageDate_idx" ON "AIUsageRecord"("usageDate");

CREATE INDEX IF NOT EXISTS "AIUsageRecord_billedPeriod_idx" ON "AIUsageRecord"("billedPeriod");

CREATE INDEX IF NOT EXISTS "AIUsageRecord_isReconciled_idx" ON "AIUsageRecord"("isReconciled");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_platform_idx" ON "MarketingCampaign"("platform");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_startDate_idx" ON "MarketingCampaign"("startDate");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_isReconciled_idx" ON "MarketingCampaign"("isReconciled");

CREATE INDEX IF NOT EXISTS "CostAuditLog_entityType_entityId_idx" ON "CostAuditLog"("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "CostAuditLog_userId_idx" ON "CostAuditLog"("userId");

CREATE INDEX IF NOT EXISTS "CostAuditLog_createdAt_idx" ON "CostAuditLog"("createdAt");

DO $$ BEGIN
  ALTER TABLE "CallSfuEjectionJob" ADD CONSTRAINT "CallSfuEjectionJob_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "AiAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_requestingUserId_fkey" FOREIGN KEY ("requestingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiTaskStep" ADD CONSTRAINT "AiTaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiToolCall" ADD CONSTRAINT "AiToolCall_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiToolCall" ADD CONSTRAINT "AiToolCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AiTaskStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiRoutine" ADD CONSTRAINT "AiRoutine_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AiSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiRoutine" ADD CONSTRAINT "AiRoutine_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TeamSkill" ADD CONSTRAINT "TeamSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Certification" ADD CONSTRAINT "Certification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectFitAssessment" ADD CONSTRAINT "ProjectFitAssessment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailFolder" ADD CONSTRAINT "EmailFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "EmailFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmailSyncState" ADD CONSTRAINT "EmailSyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceRecord" ADD CONSTRAINT "InvoiceRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Investment" ADD CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;