-- ============================================================================
-- CYRAOPS PRE-PILOT HARDENED SYNTHETIC DATA CLEANUP SCRIPT (FAIL-CLOSED)
-- TARGET DATABASE: company_os_dev ONLY
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: STRICT ENVIRONMENT & CONNECTION IDENTITY GUARD
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_port integer;
  v_addr inet;
BEGIN
  IF current_database() != 'company_os_dev' THEN
    RAISE EXCEPTION 'FATAL: Cleanup script aborted. Expected database company_os_dev, but connected to %', current_database();
  END IF;
  SELECT inet_server_port() INTO v_port;
  IF v_port IS DISTINCT FROM 5432 AND v_port IS NOT NULL THEN
    RAISE EXCEPTION 'FATAL: Expected port 5432, but connected to port %', v_port;
  END IF;
  SELECT inet_server_addr() INTO v_addr;
  IF v_addr IS NOT NULL AND v_addr != '127.0.0.1'::inet AND v_addr != '::1'::inet THEN
    RAISE EXCEPTION 'FATAL: Non-loopback server address detected: %', v_addr;
  END IF;
  RAISE NOTICE 'Connected to company_os_dev on localhost:5432. Acquiring deterministic table locks...';
END $$;

-- ----------------------------------------------------------------------------
-- STEP 1.5: EXPLICIT DETERMINISTIC TABLE LOCKS (FAIL-CLOSED CONCURRENCY SHIELD)
-- ----------------------------------------------------------------------------
-- Sets a bounded lock timeout of 5 seconds to prevent indefinite waiting.
-- Acquires EXCLUSIVE MODE locks in deterministic alphabetical order to block
-- concurrent INSERT, UPDATE, DELETE, while permitting cleanup transaction execution.
SET LOCAL lock_timeout = '5s';

LOCK TABLE
  "Activity",
  "AiAgent",
  "AiApproval",
  "AiConversation",
  "AiMessage",
  "AiSkill",
  "AiTask",
  "AiTaskStep",
  "AiToolCall",
  "AiUsageLog",
  "AIUsageRecord",
  "AuthRateLimit",
  "BusinessReadinessItem",
  "CallEvent",
  "CallIdempotencyKey",
  "CallParticipant",
  "CallSession",
  "CallSfuEjectionJob",
  "ClientInvoice",
  "Conversation",
  "ConversationMember",
  "CostAuditLog",
  "Deal",
  "DriveFile",
  "EmailAccount",
  "EmailAttachment",
  "EmailFolder",
  "EmailMessage",
  "EmailSyncState",
  "Expense",
  "ExpenseAttachment",
  "ExpenseCategory",
  "Investment",
  "InvoiceRecord",
  "Lead",
  "MarketingCampaign",
  "Message",
  "MessageRead",
  "Notification",
  "PortfolioItem",
  "Project",
  "ProjectMember",
  "ProjectPost",
  "Proposal",
  "RecurringExpense",
  "ServiceCapability",
  "Session",
  "Task",
  "TaskComment",
  "User",
  "Workspace",
  "_prisma_migrations"
IN EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- STEP 2: PRE-DELETION VERIFICATION & MANIFEST CHECKS (FAIL-CLOSED)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_hash text;
  v_cnt integer;
  v_arr text[];
  v_unassigned_ea record;
  v_owner_ea record;
BEGIN
  -- 2.1 Empty Table Assertions (Must be exactly 0 rows)
  SELECT count(*) INTO v_cnt FROM "AiApproval";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: AiApproval is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "EmailAttachment";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: EmailAttachment is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "EmailSyncState";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: EmailSyncState is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "ExpenseAttachment";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: ExpenseAttachment is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "CallIdempotencyKey";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: CallIdempotencyKey is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "DriveFile";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: DriveFile is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "ProjectPost";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: ProjectPost is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "TaskComment";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: TaskComment is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "Proposal";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: Proposal is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "Deal";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: Deal is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "Lead";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: Lead is not empty (found %)', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "ClientInvoice";
  IF v_cnt != 0 THEN RAISE EXCEPTION 'DRIFT ABORT: ClientInvoice is not empty (found %)', v_cnt; END IF;

  -- 2.2 Exact Primary-Key Array Equality Checks (Null-safe IS DISTINCT FROM)
  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "AiTask";
  IF v_arr IS DISTINCT FROM ARRAY['cmvwebmkw000axtd8kv375bxt'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: AiTask PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "AiTaskStep";
  IF v_arr IS DISTINCT FROM ARRAY['cmvwebmp7000cxtd8auzgbycz', 'cmvwebmp8000extd84f81nvvv', 'cmvwebmp9000gxtd84dfp4mp9'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: AiTaskStep PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "AiToolCall";
  IF v_arr IS DISTINCT FROM ARRAY['cmvwebmpm000ixtd858nggvgz', 'cmvwebmq1000kxtd8ydhyr7nw'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: AiToolCall PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "AIUsageRecord";
  IF v_arr IS DISTINCT FROM ARRAY['cmvzvtvjk001zxtk24bemx1rq', 'cmw3hfrsr002mxty88ffxp5ni'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: AIUsageRecord PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "Message";
  IF v_arr IS DISTINCT FROM ARRAY['cmw3dcosx002hxtwkymvyotc8', 'cmw3m01ha002oxtn008hujoje'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Message PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "MarketingCampaign";
  IF v_arr IS DISTINCT FROM ARRAY['cmvzvtvju0021xtk212vg14ua', 'cmw3hfrt0002oxty86z09u9hn'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: MarketingCampaign PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "Task";
  IF v_arr IS DISTINCT FROM ARRAY['cmvzu6nfd0001xtxjk9l16o8t', 'cmvzul1t20003xtkw36m1k7vg', 'cmvzuynw00003xtw717bsijjv', 'cmw3cj9a00001xt2sjkpvh68n'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Task PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "Notification";
  IF v_arr IS DISTINCT FROM ARRAY['cmvzv0dlh0001xt0v1m1zqxr5', 'cmw1ad88x0060xthhduaf98t7', 'cmw2psukn0001xteurk69espg', 'cmw3dcot6002ixtwknji3hi97', 'cmw3m01hn002pxtn0d29zi0ph', 'cmw53qbuu0014xtnc1oxqas4x'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Notification PK set mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "Activity";
  IF v_arr IS DISTINCT FROM ARRAY[
    'cmvvk9sjw0002xtiyf0qi3bqf',
    'cmvzu6nfg0003xtxjqfou48m7',
    'cmvzul1tb0005xtkwwsrgr9fj',
    'cmvzuynw40005xtw7hckv8aba',
    'cmw10iyzd01sqxt64v83whahe',
    'cmw10iyzv01ssxt648w30dzvk',
    'cmw3cj9a50003xt2snrm3561h',
    'cmw3dcot8002kxtwkwe39dph3',
    'cmw3m01hq002rxtn00wckijc6',
    'cmw3p2x560006xt1rb0doy6nv',
    'cmw3p2x5p000axt1r2p7t1yk1',
    'cmw3pzund0006xt9x22p0a7wp',
    'cmw3pzuo0000axt9xs4x7u94d',
    'cmw3qrro10006xtncqq6htwqz',
    'cmw3qrsjx000axtnc3buezam5'
  ] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Activity PK set mismatch';
  END IF;

  -- 2.3 EmailAccount Identity & Folder Verifications (Fail-Closed)
  SELECT count(*) INTO v_cnt FROM "EmailAccount";
  IF v_cnt != 2 THEN RAISE EXCEPTION 'DRIFT ABORT: Expected exactly 2 EmailAccount rows, found %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM "EmailFolder";
  IF v_cnt != 14 THEN RAISE EXCEPTION 'DRIFT ABORT: Expected exactly 14 EmailFolder rows, found %', v_cnt; END IF;

  SELECT id, email, "userId", "workspaceId" INTO v_unassigned_ea 
  FROM "EmailAccount" WHERE id = 'cmvwgqwhx0000xtdfei0lzslp';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRIFT ABORT: Unassigned EmailAccount cmvwgqwhx0000xtdfei0lzslp not found';
  END IF;
  IF v_unassigned_ea.email IS DISTINCT FROM 'unconfigured@cyraops.com' 
     OR v_unassigned_ea."userId" IS NOT NULL 
     OR v_unassigned_ea."workspaceId" IS DISTINCT FROM 'main' THEN
    RAISE EXCEPTION 'DRIFT ABORT: Unassigned EmailAccount attributes mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "EmailFolder" WHERE "accountId" = 'cmvwgqwhx0000xtdfei0lzslp';
  IF v_arr IS DISTINCT FROM ARRAY['cmvwgqwiz0002xtdfv1wrz7wf', 'cmvwgqwj80004xtdfmguavqyz', 'cmvwgqwj90006xtdf53vw0zs0', 'cmvwgqwjb0008xtdfz62bs5m0', 'cmvwgqwje000axtdfr7huyqab', 'cmvwgqwjf000cxtdf76t7pow3', 'cmvwgqwjg000extdf5y78wcjn'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Unassigned EmailFolders mismatch';
  END IF;

  SELECT id, email, "userId", "workspaceId" INTO v_owner_ea 
  FROM "EmailAccount" WHERE id = 'cmvzuynwb0007xtw738w2zg94';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRIFT ABORT: Owner EmailAccount cmvzuynwb0007xtw738w2zg94 not found';
  END IF;
  IF v_owner_ea.email IS DISTINCT FROM 'unconfigured@cyraops.com' 
     OR v_owner_ea."userId" IS DISTINCT FROM 'cmvvk9sam0000xtiy4d9r0l1e' 
     OR v_owner_ea."workspaceId" IS DISTINCT FROM 'main' THEN
    RAISE EXCEPTION 'DRIFT ABORT: Owner EmailAccount attributes mismatch';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "EmailFolder" WHERE "accountId" = 'cmvzuynwb0007xtw738w2zg94';
  IF v_arr IS DISTINCT FROM ARRAY['cmvzuynwd0009xtw7h20a3g49', 'cmvzuynwf000bxtw78h3pcx5n', 'cmvzuynwf000dxtw759in2mur', 'cmvzuynwg000fxtw7jtsczmpo', 'cmvzuynwg000hxtw7vs87czfp', 'cmvzuynwh000jxtw7te079ee0', 'cmvzuynwi000lxtw7dbkmrfwr'] THEN
    RAISE EXCEPTION 'DRIFT ABORT: Owner EmailFolders mismatch';
  END IF;

  -- 2.4 MD5 Sorted Primary-Key Set Digest Verifications
  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "CallSession";
  IF v_hash IS DISTINCT FROM '87c10c96072e7a89f0639b5887eb6358' OR v_cnt != 105 THEN RAISE EXCEPTION 'DRIFT ABORT: CallSession digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "CallParticipant";
  IF v_hash IS DISTINCT FROM '9d0d466153b3207d9e122ce7d3dd8ed4' OR v_cnt != 222 THEN RAISE EXCEPTION 'DRIFT ABORT: CallParticipant digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "CallEvent";
  IF v_hash IS DISTINCT FROM '475a0671bf9336abf34e63dd0c0bf4f2' OR v_cnt != 645 THEN RAISE EXCEPTION 'DRIFT ABORT: CallEvent digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "CallSfuEjectionJob";
  IF v_hash IS DISTINCT FROM 'dfc5105ba28cb5d49f4ff820f9b8cd14' OR v_cnt != 11 THEN RAISE EXCEPTION 'DRIFT ABORT: CallSfuEjectionJob digest mismatch'; END IF;

  SELECT md5(string_agg("messageId" || ':' || "userId", ',' ORDER BY "messageId", "userId")), count(*) INTO v_hash, v_cnt FROM "MessageRead";
  IF v_hash IS DISTINCT FROM '699b3ebcaed2bdc6afa3b96a61b51e09' OR v_cnt != 3 THEN RAISE EXCEPTION 'DRIFT ABORT: MessageRead digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "Conversation";
  IF v_hash IS DISTINCT FROM '44d061a70b601be8c9af3f6b3ed5164e' OR v_cnt != 12 THEN RAISE EXCEPTION 'DRIFT ABORT: Conversation digest mismatch'; END IF;

  SELECT md5(string_agg("conversationId" || ':' || "userId", ',' ORDER BY "conversationId", "userId")), count(*) INTO v_hash, v_cnt FROM "ConversationMember";
  IF v_hash IS DISTINCT FROM 'b45031f82dc9511360ee5c58dda2bec1' OR v_cnt != 26 THEN RAISE EXCEPTION 'DRIFT ABORT: ConversationMember digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "Expense";
  IF v_hash IS DISTINCT FROM '82b5feaa9f359e3659712e4e78d4b2a7' OR v_cnt != 40 THEN RAISE EXCEPTION 'DRIFT ABORT: Expense digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "Investment";
  IF v_hash IS DISTINCT FROM '9a72210b5bd412fb781713ad9c3b16b5' OR v_cnt != 34 THEN RAISE EXCEPTION 'DRIFT ABORT: Investment digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "InvoiceRecord";
  IF v_hash IS DISTINCT FROM 'c2865ced0abba981a69676c17a90711f' OR v_cnt != 34 THEN RAISE EXCEPTION 'DRIFT ABORT: InvoiceRecord digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "CostAuditLog";
  IF v_hash IS DISTINCT FROM '21bbf0f6b244f5a5cbda9065d7fe7c72' OR v_cnt != 134 THEN RAISE EXCEPTION 'DRIFT ABORT: CostAuditLog digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "RecurringExpense";
  IF v_hash IS DISTINCT FROM 'a692b5372aada372efd0b4c4eb054276' OR v_cnt != 18 THEN RAISE EXCEPTION 'DRIFT ABORT: RecurringExpense digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "AiConversation";
  IF v_hash IS DISTINCT FROM 'a94d3c4284fce588a2f271622ff7f88f' OR v_cnt != 12 THEN RAISE EXCEPTION 'DRIFT ABORT: AiConversation digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "AiMessage";
  IF v_hash IS DISTINCT FROM '2d35728332d936fab161d5f1c1c0feee' OR v_cnt != 14 THEN RAISE EXCEPTION 'DRIFT ABORT: AiMessage digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "AiUsageLog";
  IF v_hash IS DISTINCT FROM 'afb26d6728bdad5390b2b59561492125' OR v_cnt != 153 THEN RAISE EXCEPTION 'DRIFT ABORT: AiUsageLog digest mismatch'; END IF;

  SELECT md5(string_agg(id, ',' ORDER BY id)), count(*) INTO v_hash, v_cnt FROM "EmailMessage";
  IF v_hash IS DISTINCT FROM 'b9b83e7379072a143a692c15c7b5cc56' OR v_cnt != 87 THEN RAISE EXCEPTION 'DRIFT ABORT: EmailMessage digest mismatch'; END IF;

  RAISE NOTICE 'Pre-flight integrity checks ALL PASSED. Proceeding to User identity validation...';
END $$;

-- ----------------------------------------------------------------------------
-- STEP 3: USER MANIFEST PRE-FLIGHT CHECK
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE expected_synthetic_users (
  id text PRIMARY KEY,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_synthetic_users (id, email) VALUES
  ('cmw3e6kgr0000xt7mnpexkr6z', 'audit_alice@cyraops.com'),
  ('cmw3e6kgz0001xt7mkt3rxq9k', 'audit_bob@cyraops.com'),
  ('cmw3e6kh00002xt7mqspqxk6d', 'audit_charlie@cyraops.com'),
  ('cmw3jw5ox0002xttictlwdpy2', 'audit_david@cyraops.com'),
  ('cmw3i7vw8000dxt9r3n3c113q', 'audit_disabled@cyraops.com'),
  ('cmw3i7vwj000gxt9rnbg4besi', 'audit_removed@cyraops.com'),
  ('cmvzwjiwx0000xt2phg0lw90o', 'audit.member@cyraops.com'),
  ('cmw3kd7rc0000xtgjgjuyoi39', 'group_alice@cyraops.com'),
  ('cmw3kd7rh0001xtgjtwue3y02', 'group_bob@cyraops.com'),
  ('cmw3kd7ri0002xtgjwet6em4d', 'group_charlie@cyraops.com'),
  ('cmw3lsplx0000xta4kaorsrkv', 'host_rem_654884@example.com'),
  ('cmw3lt2dt0000xtbiy57iz7wo', 'host_rem_671439@example.com'),
  ('cmw3ltzyj0000xtd9g70v33kg', 'host_rem_714954@example.com'),
  ('cmw3lueq20000xtefog2jh4ny', 'host_rem_734088@example.com'),
  ('cmw3lspm30001xta4zug522rg', 'member1_rem_654884@example.com'),
  ('cmw3lt2e60001xtbifbtxcmux', 'member1_rem_671439@example.com'),
  ('cmw3ltzyy0001xtd9wfarwn3x', 'member1_rem_714954@example.com'),
  ('cmw3lueqe0001xtefnwk1dj8c', 'member1_rem_734088@example.com'),
  ('cmw3lspm50002xta4ng00q7cw', 'member2_rem_654884@example.com'),
  ('cmw3lt2e80002xtbin5gq1cn7', 'member2_rem_671439@example.com'),
  ('cmw3ltzyz0002xtd9znlov2jb', 'member2_rem_714954@example.com'),
  ('cmw3lueqg0002xtefyn6nlk0g', 'member2_rem_734088@example.com'),
  ('cmw3lspm70003xta45p4whq3w', 'outside_rem_654884@example.com'),
  ('cmw3lt2e90003xtbir8bv7bk1', 'outside_rem_671439@example.com'),
  ('cmw3ltzz10003xtd94rcxc54j', 'outside_rem_714954@example.com'),
  ('cmw3lueqh0003xtefpen623wj', 'outside_rem_734088@example.com'),
  ('cmw3d81mh0000xtzbeujyt1ex', 'phase4_alice@cyraops.com'),
  ('cmw3d81mr0001xtzbo8ua4az5', 'phase4_bob@cyraops.com'),
  ('cmw10iyzd01soxt64u91fue3k', 'probe@cyraops.com');

DO $$
DECLARE
  v_users integer;
  v_owner boolean;
  v_synth_match integer;
  v_extra integer;
BEGIN
  SELECT count(*) INTO v_users FROM "User";
  IF v_users != 30 THEN RAISE EXCEPTION 'USER ABORT: Expected 30 users, got %', v_users; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "User" 
    WHERE id = 'cmvvk9sam0000xtiy4d9r0l1e' 
      AND email = 'tanveer@cyraops.com' 
      AND role = 'OWNER'
  ) INTO v_owner;
  IF NOT v_owner THEN RAISE EXCEPTION 'USER ABORT: Founder tanveer@cyraops.com missing or altered'; END IF;

  SELECT count(*) INTO v_synth_match FROM "User" u JOIN expected_synthetic_users e ON u.id = e.id AND u.email = e.email;
  IF v_synth_match != 29 THEN RAISE EXCEPTION 'USER ABORT: Synthetic user match mismatch (found %)', v_synth_match; END IF;

  SELECT count(*) INTO v_extra FROM "User" WHERE id != 'cmvvk9sam0000xtiy4d9r0l1e' AND id NOT IN (SELECT id FROM expected_synthetic_users);
  IF v_extra > 0 THEN RAISE EXCEPTION 'USER ABORT: % unrecognized user(s) detected!', v_extra; END IF;

  RAISE NOTICE 'User pre-flight passed: exactly 29 verified synthetic accounts will be deleted.';
END $$;

-- ----------------------------------------------------------------------------
-- STEP 4: REVERSE TOPOLOGICAL PURGE EXECUTION
-- ----------------------------------------------------------------------------

-- 4.1 Calls
DELETE FROM "CallEvent";
DELETE FROM "CallParticipant";
DELETE FROM "CallSfuEjectionJob";
DELETE FROM "CallSession";
DELETE FROM "CallIdempotencyKey";

-- 4.2 Chat
DELETE FROM "MessageRead";
DELETE FROM "Message";
DELETE FROM "ConversationMember";
DELETE FROM "Conversation";

-- 4.3 Tasks & Projects
DELETE FROM "TaskComment";
DELETE FROM "Task" WHERE id IN (
  'cmvzu6nfd0001xtxjk9l16o8t',
  'cmvzul1t20003xtkw36m1k7vg',
  'cmvzuynw00003xtw717bsijjv',
  'cmw3cj9a00001xt2sjkpvh68n'
);
DELETE FROM "ProjectPost";
DELETE FROM "ProjectMember" WHERE "projectId" = 'cmvzuynuh0001xtw7772tdqqb';
DELETE FROM "Project" WHERE id = 'cmvzuynuh0001xtw7772tdqqb';

-- 4.4 Email (Purge unassigned placeholder account and messages; retain Owner account and its 7 folders)
DELETE FROM "EmailAttachment";
DELETE FROM "EmailMessage";
DELETE FROM "EmailFolder" WHERE "accountId" = 'cmvwgqwhx0000xtdfei0lzslp';
DELETE FROM "EmailAccount" WHERE id = 'cmvwgqwhx0000xtdfei0lzslp';
DELETE FROM "EmailSyncState";

-- 4.5 Finance & CRM
DELETE FROM "MarketingCampaign";
DELETE FROM "CostAuditLog";
DELETE FROM "InvoiceRecord";
DELETE FROM "ExpenseAttachment";
DELETE FROM "Expense";
DELETE FROM "RecurringExpense";
DELETE FROM "Investment";
DELETE FROM "ClientInvoice";
DELETE FROM "Proposal";
DELETE FROM "Deal";
DELETE FROM "Lead";
DELETE FROM "DriveFile";

-- 4.6 AI Subsystem
DELETE FROM "AiApproval";
DELETE FROM "AiToolCall";
DELETE FROM "AiTaskStep";
DELETE FROM "AiTask";
DELETE FROM "AiMessage";
DELETE FROM "AiConversation";
DELETE FROM "AiUsageLog";
DELETE FROM "AIUsageRecord";

-- 4.7 Activity & Sessions
DELETE FROM "Notification";
DELETE FROM "Activity" WHERE id IN (
  'cmvzu6nfg0003xtxjqfou48m7', 'cmvzul1tb0005xtkwwsrgr9fj', 'cmvzuynw40005xtw7hckv8aba',
  'cmw10iyzd01sqxt64v83whahe', 'cmw10iyzv01ssxt648w30dzvk', 'cmw3cj9a50003xt2snrm3561h',
  'cmw3dcot8002kxtwkwe39dph3', 'cmw3m01hq002rxtn00wckijc6', 'cmw3p2x560006xt1rb0doy6nv',
  'cmw3p2x5p000axt1r2p7t1yk1', 'cmw3pzund0006xt9x22p0a7wp', 'cmw3pzuo0000axt9xs4x7u94d',
  'cmw3qrro10006xtncqq6htwqz', 'cmw3qrsjx000axtnc3buezam5'
);
DELETE FROM "Session"; -- Revokes all active sessions to force fresh JWT login
DELETE FROM "AuthRateLimit";

-- 4.8 Synthetic Users
DELETE FROM "User" WHERE id IN (SELECT id FROM expected_synthetic_users);

-- ----------------------------------------------------------------------------
-- STEP 5: COMPREHENSIVE POST-CLEANUP INTEGRITY ASSERTIONS (FAIL-CLOSED)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_users integer;
  v_owner boolean;
  v_workspaces integer;
  v_workspace_ok boolean;
  v_projects integer;
  v_project_ok boolean;
  v_members integer;
  v_categories integer;
  v_capabilities integer;
  v_readiness integer;
  v_ai_agents integer;
  v_ai_skills integer;
  v_migrations integer;
  v_demo_portfolio integer;
  v_pub_portfolio integer;
  v_verified_portfolio integer;
  v_owner_email_account integer;
  v_owner_email_folders integer;
  v_activities integer;
  v_cnt integer;
  v_arr text[];
BEGIN
  -- 5.1 Retained Founder User
  SELECT count(*) INTO v_users FROM "User";
  IF v_users != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 1 user, found %', v_users; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "User" 
    WHERE id = 'cmvvk9sam0000xtiy4d9r0l1e' 
      AND email = 'tanveer@cyraops.com' 
      AND role = 'OWNER'
  ) INTO v_owner;
  IF NOT v_owner THEN RAISE EXCEPTION 'POST ASSERTION: Founder user record missing or altered'; END IF;

  SELECT count(*) INTO v_cnt FROM "User" WHERE id IN (SELECT id FROM expected_synthetic_users);
  IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: % synthetic user(s) still remain!', v_cnt; END IF;

  -- 5.2 Retained Workspace
  SELECT count(*) INTO v_workspaces FROM "Workspace";
  IF v_workspaces != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 1 workspace, found %', v_workspaces; END IF;

  SELECT EXISTS(SELECT 1 FROM "Workspace" WHERE id = 'main' AND "ownerId" = 'cmvvk9sam0000xtiy4d9r0l1e') INTO v_workspace_ok;
  IF NOT v_workspace_ok THEN RAISE EXCEPTION 'POST ASSERTION: Workspace main missing or invalid'; END IF;

  -- 5.3 Retained General Operations Project & Membership
  SELECT count(*) INTO v_projects FROM "Project";
  IF v_projects != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 1 project, found %', v_projects; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "Project" 
    WHERE id = 'cmvwhn8800001xt3x4ne3eu2l' 
      AND name = 'General Operations'
      AND "ownerId" = 'cmvvk9sam0000xtiy4d9r0l1e'
  ) INTO v_project_ok;
  IF NOT v_project_ok THEN RAISE EXCEPTION 'POST ASSERTION: General Operations project missing'; END IF;

  SELECT count(*) INTO v_members FROM "ProjectMember";
  IF v_members != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 1 project member, found %', v_members; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "ProjectMember" 
    WHERE "projectId" = 'cmvwhn8800001xt3x4ne3eu2l' 
      AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e'
      AND role = 'owner'
  ) INTO v_project_ok;
  IF NOT v_project_ok THEN RAISE EXCEPTION 'POST ASSERTION: General Operations owner membership missing'; END IF;

  -- 5.4 Retained Configuration Taxonomy
  SELECT count(*) INTO v_categories FROM "ExpenseCategory";
  IF v_categories != 33 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 33 ExpenseCategories, found %', v_categories; END IF;

  SELECT count(*) INTO v_capabilities FROM "ServiceCapability";
  IF v_capabilities != 13 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 13 ServiceCapabilities, found %', v_capabilities; END IF;

  SELECT count(*) INTO v_readiness FROM "BusinessReadinessItem";
  IF v_readiness != 8 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 8 BusinessReadinessItems, found %', v_readiness; END IF;

  SELECT count(*) INTO v_ai_agents FROM "AiAgent";
  IF v_ai_agents != 7 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 7 AiAgents, found %', v_ai_agents; END IF;

  SELECT count(*) INTO v_ai_skills FROM "AiSkill";
  IF v_ai_skills != 3 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 3 AiSkills, found %', v_ai_skills; END IF;

  SELECT count(*) INTO v_migrations FROM "_prisma_migrations";
  IF v_migrations != 11 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 11 _prisma_migrations, found %', v_migrations; END IF;

  -- 5.5 Retained Portfolio Reconciled Records
  SELECT count(*) INTO v_demo_portfolio FROM "PortfolioItem";
  IF v_demo_portfolio != 2 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 2 PortfolioItems, found %', v_demo_portfolio; END IF;

  SELECT count(*) INTO v_pub_portfolio FROM "PortfolioItem" WHERE "isPublic" = true;
  IF v_pub_portfolio != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 0 public portfolio items, found %', v_pub_portfolio; END IF;

  SELECT count(*) INTO v_verified_portfolio FROM "PortfolioItem" WHERE "isRealClient" = true;
  IF v_verified_portfolio != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Expected 0 verified client items, found %', v_verified_portfolio; END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "PortfolioItem";
  IF v_arr IS DISTINCT FROM ARRAY['cmw543rmu000oxtqu39q11v26', 'cmw543rmv000pxtqukcje952v'] THEN
    RAISE EXCEPTION 'POST ASSERTION: PortfolioItem PK set mismatch';
  END IF;

  -- 5.6 Retained Email Account & Folders
  SELECT count(*) INTO v_owner_email_account FROM "EmailAccount";
  IF v_owner_email_account != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected exactly 1 EmailAccount, found %', v_owner_email_account; END IF;

  SELECT count(*) INTO v_cnt FROM "EmailAccount" WHERE id = 'cmvzuynwb0007xtw738w2zg94' AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e' AND "workspaceId" = 'main';
  IF v_cnt != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Owner email account missing or invalid'; END IF;

  SELECT count(*) INTO v_owner_email_folders FROM "EmailFolder";
  IF v_owner_email_folders != 7 THEN RAISE EXCEPTION 'POST ASSERTION: Expected exactly 7 folders in EmailFolder, found %', v_owner_email_folders; END IF;

  SELECT array_agg(id ORDER BY id) INTO v_arr FROM "EmailFolder" WHERE "accountId" = 'cmvzuynwb0007xtw738w2zg94';
  IF v_arr IS DISTINCT FROM ARRAY['cmvzuynwd0009xtw7h20a3g49', 'cmvzuynwf000bxtw78h3pcx5n', 'cmvzuynwf000dxtw759in2mur', 'cmvzuynwg000fxtw7jtsczmpo', 'cmvzuynwg000hxtw7vs87czfp', 'cmvzuynwh000jxtw7te079ee0', 'cmvzuynwi000lxtw7dbkmrfwr'] THEN
    RAISE EXCEPTION 'POST ASSERTION: Owner EmailFolder set mismatch';
  END IF;

  -- 5.7 Retained Activity Log
  SELECT count(*) INTO v_activities FROM "Activity";
  IF v_activities != 1 THEN RAISE EXCEPTION 'POST ASSERTION: Expected exactly 1 Activity log, found %', v_activities; END IF;

  SELECT EXISTS(
    SELECT 1 FROM "Activity" 
    WHERE id = 'cmvvk9sjw0002xtiyf0qi3bqf' 
      AND action = 'created' 
      AND entity = 'workspace' 
      AND "userId" = 'cmvvk9sam0000xtiy4d9r0l1e'
  ) INTO v_project_ok;
  IF NOT v_project_ok THEN RAISE EXCEPTION 'POST ASSERTION: Initial workspace creation activity missing'; END IF;

  -- 5.8 Explicit Zero-Row Assertions for ALL Purged Tables (Fail-Closed)
  SELECT count(*) INTO v_cnt FROM "AiApproval"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiApproval not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiConversation"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiConversation not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiMessage"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiMessage not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiTask"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiTask not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiTaskStep"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiTaskStep not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiToolCall"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiToolCall not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AiUsageLog"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AiUsageLog not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AIUsageRecord"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AIUsageRecord not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "AuthRateLimit"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: AuthRateLimit not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallEvent"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CallEvent not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallIdempotencyKey"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CallIdempotencyKey not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallParticipant"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CallParticipant not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallSession"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CallSession not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CallSfuEjectionJob"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CallSfuEjectionJob not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ClientInvoice"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: ClientInvoice not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Conversation"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Conversation not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ConversationMember"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: ConversationMember not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "CostAuditLog"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: CostAuditLog not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Deal"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Deal not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "DriveFile"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: DriveFile not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailAttachment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: EmailAttachment not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailMessage"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: EmailMessage not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "EmailSyncState"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: EmailSyncState not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Expense"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Expense not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ExpenseAttachment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: ExpenseAttachment not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Investment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Investment not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "InvoiceRecord"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: InvoiceRecord not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Lead"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Lead not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "MarketingCampaign"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: MarketingCampaign not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Message"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Message not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "MessageRead"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: MessageRead not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Notification"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Notification not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "ProjectPost"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: ProjectPost not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Proposal"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Proposal not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "RecurringExpense"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: RecurringExpense not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Session"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Session not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "Task"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: Task not empty (%)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM "TaskComment"; IF v_cnt != 0 THEN RAISE EXCEPTION 'POST ASSERTION: TaskComment not empty (%)', v_cnt; END IF;

  RAISE NOTICE 'SUCCESS: All fail-closed post-cleanup assertions passed. Complete database primed for pilot.';
END $$;

COMMIT;
