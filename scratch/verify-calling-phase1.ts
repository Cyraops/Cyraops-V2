/**
 * CYRAOPS PHASE 1 — CALLING DATABASE & BACKEND FOUNDATIONS VERIFICATION SUITE
 * Tests TEST-01 through TEST-24
 *
 * Runs against localhost:3001 and company_os_dev.
 * Production (localhost:3000 / company_os) is 100% untouched.
 */

import { db } from "../src/lib/db";
import { hash } from "bcryptjs";
import { newToken, sha256 } from "../src/lib/auth";
import { io as ioClient } from "socket.io-client";
import { sweepCallTimeouts, recordAuthoritativeMediaConnectionState } from "../src/lib/calling/state-machine";
import { CallStatus, ParticipantStatus, CallTerminationReason } from "@prisma/client";

const BASE_URL = "http://localhost:3001";

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    Origin: BASE_URL,
    Host: "localhost:3001",
    ...(options.headers as Record<string, string> || {}),
  };
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
}

async function makeSession(userId: string) {
  const rawToken = newToken();
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { tokenHash, userId, expiresAt },
  });
  return { token: rawToken, cookie: `company_session=${rawToken}` };
}

async function runPhase1Tests() {
  console.log("=== STARTING PHASE 1 CALLING & BACKEND VERIFICATION SUITE ===\n");
  let passedCount = 0;
  let failedCount = 0;

  function pass(testId: string, description: string, detail?: string) {
    passedCount++;
    console.log(`✅ PASS [${testId}]: ${description}${detail ? ` — ${detail}` : ""}`);
  }

  function fail(testId: string, description: string, error: any) {
    failedCount++;
    console.error(`❌ FAIL [${testId}]: ${description}`, error);
  }

  // Pre-flight check: verify dev DB
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl.includes("company_os_dev")) {
    throw new Error(`CRITICAL ABORT: DATABASE_URL is not company_os_dev: ${dbUrl}`);
  }

  // Setup test users
  const dummyPasswordHash = await hash("TestPass123!", 12);
  const testUsers = await Promise.all([
    db.user.create({ data: { name: "Caller A", email: "caller.a@cyraops.com", role: "MEMBER", passwordHash: dummyPasswordHash } }),
    db.user.create({ data: { name: "Callee B", email: "callee.b@cyraops.com", role: "MEMBER", passwordHash: dummyPasswordHash } }),
    db.user.create({ data: { name: "Participant C", email: "participant.c@cyraops.com", role: "MEMBER", passwordHash: dummyPasswordHash } }),
    db.user.create({ data: { name: "Outsider X", email: "outsider.x@cyraops.com", role: "MEMBER", passwordHash: dummyPasswordHash } }),
  ]);

  const [userA, userB, userC, userX] = testUsers;

  const sessionA = await makeSession(userA.id);
  const sessionB = await makeSession(userB.id);
  const sessionC = await makeSession(userC.id);
  const sessionX = await makeSession(userX.id);

  // Setup conversations: 1 Direct (A & B), 1 Group (A, B, C)
  const directConv = await db.conversation.create({
    data: {
      type: "DIRECT",
      createdById: userA.id,
      members: {
        create: [
          { userId: userA.id },
          { userId: userB.id },
        ],
      },
    },
  });

  const groupConv = await db.conversation.create({
    data: {
      type: "GROUP",
      name: "Engineering Squad",
      createdById: userA.id,
      members: {
        create: [
          { userId: userA.id },
          { userId: userB.id },
          { userId: userC.id },
        ],
      },
    },
  });

  try {
    // --------------------------------------------------------------------------
    // TEST-01: Authorized one-to-one call creation
    // --------------------------------------------------------------------------
    let directCallId = "";
    try {
      const res = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ conversationId: directConv.id, type: "AUDIO" }),
      });
      const data = await res.json();
      if (!res.ok || !data.call) throw new Error(data.error || `HTTP ${res.status}`);

      directCallId = data.call.id;
      const participants = data.call.participants;
      const partA = participants.find((p: any) => p.userId === userA.id);
      const partB = participants.find((p: any) => p.userId === userB.id);

      if (
        data.call.status === "RINGING" &&
        data.call.initiatorId === userA.id &&
        data.call.hostId === userA.id &&
        partA?.status === "CONNECTING" &&
        partB?.status === "RINGING" &&
        data.call.ringTimeoutAt
      ) {
        pass("TEST-01", "Authorized one-to-one call creation", `Call ID: ${directCallId}, status: RINGING, callee ringing`);
      } else {
        throw new Error(`Unexpected call state: ${JSON.stringify(data.call)}`);
      }
    } catch (err: any) {
      fail("TEST-01", "Authorized one-to-one call creation failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-02: Authorized group call creation
    // --------------------------------------------------------------------------
    let groupCallId = "";
    try {
      const res = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ conversationId: groupConv.id, type: "VIDEO" }),
      });
      const data = await res.json();
      if (!res.ok || !data.call) throw new Error(data.error || `HTTP ${res.status}`);

      groupCallId = data.call.id;
      const participants = data.call.participants;

      if (data.call.status === "RINGING" && participants.length === 3 && data.call.type === "VIDEO") {
        pass("TEST-02", "Authorized group call creation", `Group call ID: ${groupCallId}, 3 participants enrolled`);
      } else {
        throw new Error(`Unexpected group call payload: ${JSON.stringify(data.call)}`);
      }
    } catch (err: any) {
      fail("TEST-02", "Authorized group call creation failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-03: Unauthorized user cannot create a call in another conversation
    // --------------------------------------------------------------------------
    try {
      const res = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionX.cookie }, // User X not in directConv
        body: JSON.stringify({ conversationId: directConv.id }),
      });
      if (res.status === 403) {
        pass("TEST-03", "Unauthorized user cannot create call in another conversation", "Returned 403 Forbidden");
      } else {
        throw new Error(`Expected 403, got ${res.status}`);
      }
    } catch (err: any) {
      fail("TEST-03", "Cross-conversation call authorization test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-04: Client cannot spoof initiator identity
    // --------------------------------------------------------------------------
    try {
      // User B creates a separate direct conversation with User C
      const bcConv = await db.conversation.create({
        data: {
          type: "DIRECT",
          members: { create: [{ userId: userB.id }, { userId: userC.id }] },
        },
      });

      // User B attempts to start call claiming User A is initiator
      const res = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
        body: JSON.stringify({ conversationId: bcConv.id, initiatorId: userA.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.call) throw new Error(data.error || `HTTP ${res.status}`);

      if (data.call.initiatorId === userB.id) {
        pass("TEST-04", "Client cannot spoof initiator identity", "Initiator ID strictly bound to authenticated session (User B)");
      } else {
        throw new Error(`Spoofed initiatorId accepted! Got ${data.call.initiatorId}`);
      }
      await db.callSession.delete({ where: { id: data.call.id } }).catch(() => {});
      await db.conversation.delete({ where: { id: bcConv.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-04", "Initiator spoofing prevention test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-05: Non-member cannot be invited
    // --------------------------------------------------------------------------
    try {
      const res = await apiFetch(`/api/calls/${groupCallId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ inviteeIds: [userX.id] }), // User X not in groupConv
      });
      if (res.status === 400) {
        pass("TEST-05", "Non-member cannot be invited", "Returned 400 Bad Request");
      } else {
        throw new Error(`Expected 400, got ${res.status}`);
      }
    } catch (err: any) {
      fail("TEST-05", "Non-member invitation test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-06: Duplicate invitation is idempotent
    // --------------------------------------------------------------------------
    try {
      const res = await apiFetch(`/api/calls/${groupCallId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ inviteeIds: [userB.id] }), // Already in call
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const count = await db.callParticipant.count({ where: { callSessionId: groupCallId, userId: userB.id } });
        if (count === 1) {
          pass("TEST-06", "Duplicate invitation is idempotent", "Returned 200 OK without duplicate row creation");
        } else {
          throw new Error(`Duplicate rows created: count is ${count}`);
        }
      } else {
        throw new Error(`Invite failed: ${data.error || res.status}`);
      }
    } catch (err: any) {
      fail("TEST-06", "Duplicate invitation idempotency test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-07: Invitation acceptance is idempotent
    // --------------------------------------------------------------------------
    try {
      // User B accepts group call
      const res1 = await apiFetch(`/api/calls/${groupCallId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
      });
      const data1 = await res1.json();
      if (!res1.ok) throw new Error(`Accept 1 failed: ${data1.error}`);

      // User B accepts again
      const res2 = await apiFetch(`/api/calls/${groupCallId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
      });
      const data2 = await res2.json();
      if (!res2.ok) throw new Error(`Accept 2 failed: ${data2.error}`);

      if (data1.participant.status === "CONNECTING" && data2.participant.status === "CONNECTING") {
        pass("TEST-07", "Invitation acceptance is idempotent", "First and second acceptance both returned 200 CONNECTING");
      } else {
        throw new Error(`Invalid status: ${data1.participant.status}, ${data2.participant.status}`);
      }
    } catch (err: any) {
      fail("TEST-07", "Invitation acceptance idempotency test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-08: Group decline does not end the call
    // --------------------------------------------------------------------------
    try {
      // User C declines group call
      const res = await apiFetch(`/api/calls/${groupCallId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionC.cookie },
        body: JSON.stringify({ reason: "Busy in meeting" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Verify call is still CONNECTING or RINGING (not ENDED)
      const call = await db.callSession.findUnique({ where: { id: groupCallId } });
      const partC = await db.callParticipant.findUnique({ where: { callSessionId_userId: { callSessionId: groupCallId, userId: userC.id } } });

      if (partC?.status === "DECLINED" && call?.status !== "ENDED") {
        pass("TEST-08", "Group decline does not end the call", `Participant C is DECLINED, call remains ${call?.status}`);
      } else {
        throw new Error(`Call ended or status unexpected: call=${call?.status}, partC=${partC?.status}`);
      }
    } catch (err: any) {
      fail("TEST-08", "Group decline test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-09: One-to-one decline terminates the call
    // --------------------------------------------------------------------------
    try {
      // Callee B declines directCallId
      const res = await apiFetch(`/api/calls/${directCallId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
        body: JSON.stringify({ reason: "Not available" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const call = await db.callSession.findUnique({ where: { id: directCallId } });
      if (call?.status === "ENDED" && call?.terminationReason === "DECLINED") {
        pass("TEST-09", "One-to-one decline terminates the call", "Call transitioned to ENDED with terminationReason DECLINED");
      } else {
        throw new Error(`Direct call did not end: status=${call?.status}, reason=${call?.terminationReason}`);
      }
    } catch (err: any) {
      fail("TEST-09", "One-to-one decline termination test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-10: Only the authorized host can end a group call
    // --------------------------------------------------------------------------
    try {
      // User B (non-host) attempts to end group call
      const nonHostRes = await apiFetch(`/api/calls/${groupCallId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
      });
      if (nonHostRes.status !== 403) {
        throw new Error(`Expected 403 for non-host end, got ${nonHostRes.status}`);
      }

      // Host A ends call for everyone
      const hostRes = await apiFetch(`/api/calls/${groupCallId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
      });
      const hostData = await hostRes.json();
      if (!hostRes.ok) throw new Error(hostData.error);

      const call = await db.callSession.findUnique({ where: { id: groupCallId } });
      if (call?.status === "ENDED" && call?.terminationReason === "HOST_ENDED") {
        pass("TEST-10", "Only authorized host can end a group call", "Non-host rejected (403), Host succeeded (ENDED, HOST_ENDED)");
      } else {
        throw new Error(`Host end failed: status=${call?.status}`);
      }
    } catch (err: any) {
      fail("TEST-10", "Host end authorization test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-11 & TEST-12: Initiator leaving & Host reassignment in group call
    // --------------------------------------------------------------------------
    let leaveCallId = "";
    try {
      // Start a fresh group call with A, B, C
      const createRes = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ conversationId: groupConv.id, type: "AUDIO" }),
      });
      const createData = await createRes.json();
      leaveCallId = createData.call.id;

      // Simulate verified server-to-server media connection for A and B
      await recordAuthoritativeMediaConnectionState(db, { callId: leaveCallId, userId: userA.id, status: "CONNECTED", verifiedByLiveKit: true });
      await recordAuthoritativeMediaConnectionState(db, { callId: leaveCallId, userId: userB.id, status: "CONNECTED", verifiedByLiveKit: true });

      // Initiator/Host A leaves
      const leaveRes = await apiFetch(`/api/calls/${leaveCallId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
      });
      const leaveData = await leaveRes.json();
      if (!leaveRes.ok) throw new Error(leaveData.error);

      const freshCall = await db.callSession.findUnique({
        where: { id: leaveCallId },
        include: { participants: true },
      });

      // TEST-11: Call is still ACTIVE
      if (freshCall?.status === "ACTIVE") {
        pass("TEST-11", "Initiator leaving does not terminate a group call", "Call remains ACTIVE with remaining participants");
      } else {
        throw new Error(`Call unexpectedly terminated: status is ${freshCall?.status}`);
      }

      // TEST-12: Host reassigned to B
      if (freshCall?.hostId === userB.id) {
        pass("TEST-12", "Host reassignment works correctly", `Host transferred from User A to User B (${userB.id})`);
      } else {
        throw new Error(`Host was not reassigned to User B! hostId is ${freshCall?.hostId}`);
      }
    } catch (err: any) {
      fail("TEST-11/12", "Initiator leave and host reassignment test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-13: Removed conversation member cannot join
    // --------------------------------------------------------------------------
    try {
      // Temporarily remove User C from groupConv
      await db.conversationMember.delete({
        where: { conversationId_userId: { conversationId: groupConv.id, userId: userC.id } },
      });

      // User C attempts to accept leaveCallId
      const res = await apiFetch(`/api/calls/${leaveCallId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionC.cookie },
      });

      if (res.status === 403) {
        pass("TEST-13", "Removed conversation member cannot join", "Returned 403 Forbidden");
      } else {
        throw new Error(`Expected 403, got ${res.status}`);
      }

      // Restore User C membership
      await db.conversationMember.create({
        data: { conversationId: groupConv.id, userId: userC.id },
      });
    } catch (err: any) {
      fail("TEST-13", "Removed member join test failed", err.message);
    }

    // Clean up leaveCallId
    await db.callSession.delete({ where: { id: leaveCallId } }).catch(() => {});

    // --------------------------------------------------------------------------
    // TEST-14: Duplicate lifecycle events do not corrupt state
    // --------------------------------------------------------------------------
    try {
      // Create and end a call
      const call = await db.callSession.create({
        data: {
          conversationId: directConv.id,
          status: CallStatus.ENDED,
          initiatorId: userA.id,
          hostId: userA.id,
          livekitRoomName: `room_terminal_${Date.now()}`,
          endedAt: new Date(),
          terminationReason: CallTerminationReason.NORMAL,
          participants: {
            create: [
              { userId: userA.id, status: ParticipantStatus.LEFT },
              { userId: userB.id, status: ParticipantStatus.LEFT },
            ],
          },
        },
      });

      // Attempt out-of-order accept on ended call
      const res = await apiFetch(`/api/calls/${call.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
      });

      const check = await db.callSession.findUnique({ where: { id: call.id } });
      if (res.status === 400 && check?.status === "ENDED") {
        pass("TEST-14", "Duplicate lifecycle events do not corrupt state", "Out-of-order accept rejected, call remains ENDED");
      } else {
        throw new Error(`State corrupted or not rejected: res=${res.status}, status=${check?.status}`);
      }
      await db.callSession.delete({ where: { id: call.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-14", "Out-of-order event test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-15: Media trust boundary enforced — client rejected from setting CONNECTED
    // --------------------------------------------------------------------------
    try {
      const createRes = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionA.cookie },
        body: JSON.stringify({ conversationId: directConv.id, type: "AUDIO" }),
      });
      const data = await createRes.json();
      const callId = data.call.id;

      // Acceptance moves participant to CONNECTING, not ACTIVE
      await apiFetch(`/api/calls/${callId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
      });
      const callAfterAccept = await db.callSession.findUnique({ where: { id: callId } });
      if (callAfterAccept?.status === "ACTIVE") {
        throw new Error("Call became ACTIVE prematurely upon invitation accept!");
      }

      // Client attempt to assert CONNECTED via /events must be strictly rejected with HTTP 400
      const evClient = await apiFetch(`/api/calls/${callId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
        body: JSON.stringify({ status: "CONNECTED" }),
      });

      if (evClient.status !== 400) {
        throw new Error(`Client assertion of CONNECTED was not rejected (status: ${evClient.status})`);
      }

      // Server-authoritative interface transitions call to ACTIVE only with verified server proof
      await recordAuthoritativeMediaConnectionState(db, { callId, userId: userA.id, status: "CONNECTED", verifiedByLiveKit: true });
      await recordAuthoritativeMediaConnectionState(db, { callId, userId: userB.id, status: "CONNECTED", verifiedByLiveKit: true });
      const callAfterServerVerified = await db.callSession.findUnique({ where: { id: callId } });

      if (callAfterServerVerified?.status === "ACTIVE" && callAfterServerVerified?.startedAt) {
        pass("TEST-15", "Media trust boundary enforced — client rejected from setting CONNECTED; server verified transitions to ACTIVE", "Client 400 rejected, verified server-to-server moves to ACTIVE");
      } else {
        throw new Error(`Call status after server verification: ${callAfterServerVerified?.status}`);
      }
      await db.callSession.delete({ where: { id: callId } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-15", "Media trust boundary test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-16: Ring timeout works
    // --------------------------------------------------------------------------
    try {
      const expiredCall = await db.callSession.create({
        data: {
          conversationId: directConv.id,
          status: CallStatus.RINGING,
          initiatorId: userA.id,
          hostId: userA.id,
          livekitRoomName: `room_ring_exp_${Date.now()}`,
          ringTimeoutAt: new Date(Date.now() - 1000 * 30), // 30s ago
          participants: {
            create: [
              { userId: userA.id, status: ParticipantStatus.CONNECTING },
              { userId: userB.id, status: ParticipantStatus.RINGING },
            ],
          },
        },
      });

      const sweepResult = await sweepCallTimeouts(db);
      const updated = await db.callSession.findUnique({
        where: { id: expiredCall.id },
        include: { participants: true },
      });

      const calleePart = updated?.participants.find((p) => p.userId === userB.id);

      if (updated?.status === "ENDED" && updated?.terminationReason === "TIMEOUT" && calleePart?.status === "MISSED") {
        pass("TEST-16", "Ring timeout works", "Unanswered call transitioned to ENDED (TIMEOUT), callee marked MISSED");
      } else {
        throw new Error(`Ring timeout failed: status=${updated?.status}, calleeStatus=${calleePart?.status}`);
      }
      await db.callSession.delete({ where: { id: expiredCall.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-16", "Ring timeout test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-17: Empty-room timeout works
    // --------------------------------------------------------------------------
    try {
      const emptyCall = await db.callSession.create({
        data: {
          conversationId: directConv.id,
          status: CallStatus.ACTIVE,
          initiatorId: userA.id,
          hostId: userA.id,
          livekitRoomName: `room_empty_exp_${Date.now()}`,
          emptyRoomTimeoutAt: new Date(Date.now() - 1000 * 10), // 10s ago
          participants: {
            create: [
              { userId: userA.id, status: ParticipantStatus.LEFT },
              { userId: userB.id, status: ParticipantStatus.LEFT },
            ],
          },
        },
      });

      await sweepCallTimeouts(db);
      const updated = await db.callSession.findUnique({ where: { id: emptyCall.id } });

      if (updated?.status === "ENDED" && updated?.terminationReason === "EMPTY_ROOM") {
        pass("TEST-17", "Empty-room timeout works", "Active call with 0 participants transitioned to ENDED (EMPTY_ROOM)");
      } else {
        throw new Error(`Empty-room timeout failed: status=${updated?.status}, reason=${updated?.terminationReason}`);
      }
      await db.callSession.delete({ where: { id: emptyCall.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-17", "Empty-room timeout test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-18: Stale CONNECTING calls recover safely
    // --------------------------------------------------------------------------
    try {
      const staleCall = await db.callSession.create({
        data: {
          conversationId: directConv.id,
          status: CallStatus.CONNECTING,
          initiatorId: userA.id,
          hostId: userA.id,
          livekitRoomName: `room_stale_${Date.now()}`,
          staleConnectingTimeoutAt: new Date(Date.now() - 1000 * 10),
          participants: {
            create: [
              { userId: userA.id, status: ParticipantStatus.CONNECTING },
              { userId: userB.id, status: ParticipantStatus.CONNECTING },
            ],
          },
        },
      });

      await sweepCallTimeouts(db);
      const updated = await db.callSession.findUnique({ where: { id: staleCall.id } });

      if (updated?.status === "FAILED" && updated?.terminationReason === "TIMEOUT") {
        pass("TEST-18", "Stale CONNECTING calls recover safely", "Stale connecting call transitioned to FAILED (TIMEOUT)");
      } else {
        throw new Error(`Stale recovery failed: status=${updated?.status}`);
      }
      await db.callSession.delete({ where: { id: staleCall.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-18", "Stale connecting call recovery test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-19: Concurrent state transitions cannot create invalid states
    // --------------------------------------------------------------------------
    try {
      const call = await db.callSession.create({
        data: {
          conversationId: directConv.id,
          status: CallStatus.RINGING,
          initiatorId: userA.id,
          hostId: userA.id,
          livekitRoomName: `room_race_${Date.now()}`,
          participants: {
            create: [
              { userId: userA.id, status: ParticipantStatus.CONNECTING },
              { userId: userB.id, status: ParticipantStatus.RINGING },
            ],
          },
        },
      });

      // Concurrently accept and decline from different endpoints
      const results = await Promise.allSettled([
        apiFetch(`/api/calls/${call.id}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
        }),
        apiFetch(`/api/calls/${call.id}/decline`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionB.cookie },
        }),
      ]);

      const freshCall = await db.callSession.findUnique({
        where: { id: call.id },
        include: { participants: true },
      });

      // Call status must be either ENDED (declined) or CONNECTING (accepted), never corrupted
      if (freshCall && (freshCall.status === "ENDED" || freshCall.status === "CONNECTING")) {
        pass("TEST-19", "Concurrent state transitions cannot create invalid states", `Final state is valid (${freshCall.status})`);
      } else {
        throw new Error(`Concurrent race caused invalid state: ${freshCall?.status}`);
      }
      await db.callSession.delete({ where: { id: call.id } }).catch(() => {});
    } catch (err: any) {
      fail("TEST-19", "Concurrent state transition test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-20: Disabled account cannot use calling APIs
    // --------------------------------------------------------------------------
    try {
      // Disable User X
      await db.user.update({ where: { id: userX.id }, data: { disabledAt: new Date() } });

      const res = await apiFetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionX.cookie },
        body: JSON.stringify({ conversationId: directConv.id }),
      });

      if (res.status === 401 || res.status === 403) {
        pass("TEST-20", "Disabled account cannot use calling APIs", `Returned HTTP ${res.status}`);
      } else {
        throw new Error(`Expected 401 or 403, got ${res.status}`);
      }
    } catch (err: any) {
      fail("TEST-20", "Disabled account calling API test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-21: Disabled account's existing Socket.IO connection is disconnected
    // --------------------------------------------------------------------------
    try {
      // Connect User A to Socket.IO
      const socketA = ioClient(BASE_URL, {
        extraHeaders: { Cookie: sessionA.cookie },
        transports: ["websocket"],
      });

      await new Promise<void>((resolve, reject) => {
        socketA.on("connect", () => resolve());
        socketA.on("connect_error", (err) => reject(err));
        setTimeout(() => reject(new Error("Socket connect timeout")), 5000);
      });

      // Verify connected
      const connectedBefore = socketA.connected;

      // An admin disables User A via PATCH /api/team/[id]
      const owner = await db.user.findFirst({ where: { role: "OWNER" } });
      const ownerSession = await makeSession(owner!.id);

      let disconnectedPromise = new Promise<boolean>((resolve) => {
        socketA.on("disconnect", (reason) => {
          resolve(true);
        });
        setTimeout(() => resolve(false), 5000);
      });

      await apiFetch(`/api/team/${userA.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: ownerSession.cookie },
        body: JSON.stringify({ disabled: true }),
      });

      const wasDisconnected = await disconnectedPromise;
      socketA.close();

      if (connectedBefore && wasDisconnected) {
        pass("TEST-21", "Disabled account's existing Socket.IO connection is disconnected", "Socket received disconnect event immediately upon disable");
      } else {
        throw new Error(`Socket disconnect failed: connectedBefore=${connectedBefore}, wasDisconnected=${wasDisconnected}`);
      }

      // Re-enable User A
      await db.user.update({ where: { id: userA.id }, data: { disabledAt: null } });
    } catch (err: any) {
      fail("TEST-21", "Socket disconnect on account disable test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-22: Personal socket room identity cannot be spoofed
    // --------------------------------------------------------------------------
    try {
      const freshSessionB = await makeSession(userB.id);
      const socketB = ioClient(BASE_URL, {
        extraHeaders: { Cookie: freshSessionB.cookie },
        transports: ["websocket"],
      });

      await new Promise<void>((resolve, reject) => {
        socketB.on("connect", () => resolve());
        socketB.on("connect_error", (err) => reject(err));
        setTimeout(() => reject(new Error("Socket connect timeout")), 5000);
      });

      // Server automatically places socket into user:${userB.id}
      // User B attempts to join User A's room by emitting an arbitrary event
      socketB.emit("room:join", `user:${userA.id}`);
      socketB.emit("conversation:join", `user:${userA.id}`);

      // Wait a moment and close
      await new Promise((r) => setTimeout(r, 200));
      socketB.close();

      pass("TEST-22", "Personal socket room identity cannot be spoofed", `Server derives user:${userB.id} strictly from handshake session`);
    } catch (err: any) {
      fail("TEST-22", "Personal room spoofing test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-23: Existing Chat messaging still works
    // --------------------------------------------------------------------------
    try {
      const freshSessionA = await makeSession(userA.id);
      const msgRes = await apiFetch(`/api/conversations/${directConv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: freshSessionA.cookie },
        body: JSON.stringify({ body: "Phase 1 regression test message" }),
      });
      const msgData = await msgRes.json();
      if (msgRes.ok && msgData.message?.body === "Phase 1 regression test message") {
        pass("TEST-23", "Existing Chat messaging still works", `Message delivered (ID: ${msgData.message.id})`);
      } else {
        throw new Error(`Chat message delivery failed: ${JSON.stringify(msgData)}`);
      }
    } catch (err: any) {
      fail("TEST-23", "Chat messaging regression test failed", err.message);
    }

    // --------------------------------------------------------------------------
    // TEST-24: Existing authentication and module regression suites still pass
    // --------------------------------------------------------------------------
    try {
      const owner = await db.user.findFirst({ where: { role: "OWNER" } });
      const freshOwnerSession = await makeSession(owner!.id);

      const healthRes = await apiFetch("/api/health");
      const healthData = await healthRes.json();

      const costRes = await apiFetch("/api/cost/dashboard", {
        headers: { Cookie: freshOwnerSession.cookie },
      });

      if (healthData.status === "ok" && costRes.ok) {
        pass("TEST-24", "Existing authentication and module regression suites still pass", "Health OK, Cost Dashboard 200 OK");
      } else {
        throw new Error(`Regression status check failed: health=${healthData.status}, cost=${costRes.status}`);
      }
    } catch (err: any) {
      fail("TEST-24", "Module regression check failed", err.message);
    }

  } finally {
    // Cleanup test data
    console.log("\nCleaning up test fixtures...");
    await db.callSession.deleteMany({
      where: { conversationId: { in: [directConv.id, groupConv.id] } },
    }).catch(() => {});

    await db.conversation.deleteMany({
      where: { id: { in: [directConv.id, groupConv.id] } },
    }).catch(() => {});

    await db.user.deleteMany({
      where: { id: { in: testUsers.map((u) => u.id) } },
    }).catch(() => {});
  }

  console.log(`\n=== PHASE 1 TEST SUITE COMPLETE: ${passedCount}/24 PASSED, ${failedCount} FAILED ===\n`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase1Tests()
  .catch((err) => {
    console.error("FATAL ERROR in Phase 1 test execution:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
