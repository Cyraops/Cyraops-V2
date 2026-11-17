-- ============================================================================
-- CYRAOPS INDEPENDENT POST-PURGE DATABASE VERIFICATION SCRIPT
-- STRICTLY READ-ONLY ASSERTION SUITE — TARGET: company_os_dev ONLY
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_port integer;
  v_addr inet;
  v_cnt integer;
  v_arr text[];
  v_ok boolean;
BEGIN
  -- 1. STRICT ENDPOINT & RUNTIME IDENTITY GUARD
  IF current_database() != 'company_os_dev' THEN
    RAISE EXCEPTION 'FATAL: Expected database company_os_dev, but connected to %', current_database();
  END IF;

  SELECT inet_server_port() INTO v_port;
  IF v_port IS DISTINCT FROM 5432 AND v_port IS NOT NULL THEN
    RAISE EXCEPTION 'FATAL: Expected port 5432, but connected to port %', v_port;
  END IF;

  SELECT inet_server_addr() INTO v_addr;
  IF v_addr IS NOT NULL AND v_addr != '127.0.0.1'::inet AND v_addr != '::1'::inet THEN
    RAISE EXCEPTION 'FATAL: Non-loopback server address detected: %', v_addr;
  END IF;

  RAISE NOTICE 'Endpoint verified: company_os_dev on localhost:5432. Running independent assertions...';

  -- 2. FOUNDER USER ASSERTIONS
  SELECT count(*) INTO v_cnt FROM "User";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 User, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "User" 
    WHERE id = 'cmvvk9sam0000xtiy4d9r0l1e' 
      AND email = 'tanveer@cyraops.com' 
      AND role = 'OWNER'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Founder tanveer@cyraops.com missing or altered'; END IF;

  SELECT count(*) INTO v_cnt FROM "User" WHERE email != 'tanveer@cyraops.com';
  IF v_cnt != 0 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: % unrecognized or synthetic user(s) remain!', v_cnt; END IF;

  -- 3. MAIN WORKSPACE ASSERTIONS
  SELECT count(*) INTO v_cnt FROM "Workspace";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 Workspace, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "Workspace" 
    WHERE id = 'main' AND "ownerId" = 'cmvvk9sam0000xtiy4d9r0l1e'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Workspace main missing or invalid owner'; END IF;

  -- 4. GENERAL OPERATIONS PROJECT & MEMBERSHIP
  SELECT count(*) INTO v_cnt FROM "Project";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 Project, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "Project" 
    WHERE id = 'cmvwhn8800001xt3x4ne3eu2l' 
      AND name = 'General Operations' 
      AND "ownerId" = 'cmvvk9sam0000xtiy4d9r0l1e'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: General Operations project missing or invalid'; END IF;

  SELECT count(*) INTO v_cnt FROM "ProjectMember";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 ProjectMember, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "ProjectMember" 
    WHERE "projectId" = 'cmvwhn8800001xt3x4ne3eu2l' 
      AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e' 
      AND role = 'owner'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: General Operations owner membership missing'; END IF;

  -- 5. CONFIGURATION TAXONOMIES
  SELECT count(*) INTO v_cnt FROM "ExpenseCategory";
  IF v_cnt != 33 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 33 ExpenseCategories, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "ServiceCapability";
  IF v_cnt != 13 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 13 ServiceCapabilities, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "BusinessReadinessItem";
  IF v_cnt != 8 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 8 BusinessReadinessItems, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "AiAgent";
  IF v_cnt != 7 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 7 AiAgents, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "AiSkill";
  IF v_cnt != 3 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 3 AiSkills, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "_prisma_migrations";
  IF v_cnt != 11 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 11 _prisma_migrations, found %', v_cnt; END IF;

  -- 6. PORTFOLIO DEMONSTRATION CARDS
  SELECT count(*) INTO v_cnt FROM "PortfolioItem";
  IF v_cnt != 2 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 2 PortfolioItems, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "PortfolioItem" WHERE "isPublic" = true;
  IF v_cnt != 0 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: % public portfolio item(s) found!', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "PortfolioItem" WHERE "isRealClient" = true;
  IF v_cnt != 0 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: % verified client portfolio item(s) found!', v_cnt; END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "PortfolioItem";
  IF v_arr IS DISTINCT FROM ARRAY['cmw543rmu000oxtqu39q11v26', 'cmw543rmv000pxtqukcje952v'] THEN
    RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: PortfolioItem primary keys mismatch';
  END IF;

  -- 7. OWNER MAILBOX & STANDARD FOLDERS
  SELECT count(*) INTO v_cnt FROM "EmailAccount";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 EmailAccount, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "EmailAccount" 
    WHERE id = 'cmvzuynwb0007xtw738w2zg94' 
      AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e'
      AND "workspaceId" = 'main'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Owner email account missing or invalid'; END IF;

  SELECT count(*) INTO v_cnt FROM "EmailFolder";
  IF v_cnt != 7 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 7 EmailFolders, found %', v_cnt; END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "EmailFolder" WHERE "accountId" = 'cmvzuynwb0007xtw738w2zg94';
  IF v_arr IS DISTINCT FROM ARRAY['cmvzuynwd0009xtw7h20a3g49', 'cmvzuynwf000bxtw78h3pcx5n', 'cmvzuynwf000dxtw759in2mur', 'cmvzuynwg000fxtw7jtsczmpo', 'cmvzuynwg000hxtw7vs87czfp', 'cmvzuynwh000jxtw7te079ee0', 'cmvzuynwi000lxtw7dbkmrfwr'] THEN
    RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Owner EmailFolder set mismatch';
  END IF;

  -- 8. WORKSPACE CREATION AUDIT ACTIVITY
  SELECT count(*) INTO v_cnt FROM "Activity";
  IF v_cnt != 1 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Expected 1 Activity log, found %', v_cnt; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "Activity" 
    WHERE id = 'cmvvk9sjw0002xtiyf0qi3bqf' 
      AND action = 'created' 
      AND entity = 'workspace' 
      AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: Initial workspace creation activity missing'; END IF;

  -- 9. SESSIONS REVOKED
  SELECT count(*) INTO v_cnt FROM "Session";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'INDEPENDENT ASSERTION FAILED: % active session(s) still exist! Must be 0.', v_cnt; END IF;

  -- 10. ALL 38 PURGED TABLES ASSERTED ZERO ROWS
  SELECT count(*) INTO v_cnt FROM "AiApproval"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiApproval has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiConversation"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiConversation has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiMessage"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiMessage has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiTask"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiTask has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiTaskStep"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiTaskStep has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiToolCall"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiToolCall has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiUsageLog"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AiUsageLog has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AIUsageRecord"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AIUsageRecord has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AuthRateLimit"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: AuthRateLimit has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallEvent"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CallEvent has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallIdempotencyKey"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CallIdempotencyKey has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallParticipant"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CallParticipant has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallSession"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CallSession has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallSfuEjectionJob"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CallSfuEjectionJob has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ClientInvoice"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: ClientInvoice has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Conversation"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Conversation has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ConversationMember"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: ConversationMember has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CostAuditLog"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: CostAuditLog has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Deal"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Deal has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "DriveFile"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: DriveFile has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailAttachment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: EmailAttachment has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailMessage"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: EmailMessage has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailSyncState"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: EmailSyncState has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Expense"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Expense has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ExpenseAttachment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: ExpenseAttachment has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Investment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Investment has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "InvoiceRecord"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: InvoiceRecord has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Lead"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Lead has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "MarketingCampaign"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: MarketingCampaign has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Message"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Message has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "MessageRead"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: MessageRead has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Notification"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Notification has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ProjectPost"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: ProjectPost has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Proposal"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Proposal has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "RecurringExpense"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: RecurringExpense has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Task"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: Task has % rows', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "TaskComment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'PURGE CHECK FAILED: TaskComment has % rows', v_cnt; END IF;

  RAISE NOTICE 'SUCCESS: Independent post-purge verification PASSED. Database is 100%% verified in pristine state.';
END $$;

