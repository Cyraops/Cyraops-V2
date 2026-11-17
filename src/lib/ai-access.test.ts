import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aiTaskVisibilityWhere,
  canOperateAiTask,
  canViewAiConversation,
  canViewAiTask,
  canViewOrgWideAiTasks,
  isDepartmentAdmin,
} from "./ai/access";
import { canTransition } from "./ai/agents/lifecycle";

const owner = { id: "user-owner", role: "OWNER" };
const admin = { id: "user-admin", role: "ADMIN" };
const member = { id: "user-member", role: "MEMBER" };
const otherMember = { id: "user-other", role: "MEMBER" };

describe("AI workspace authorization", () => {
  it("treats Owners and Admins as department admins", () => {
    assert.equal(isDepartmentAdmin(owner), true);
    assert.equal(isDepartmentAdmin(admin), true);
    assert.equal(isDepartmentAdmin(member), false);
  });

  it("only allows Owners and Admins organization-wide task visibility", () => {
    assert.equal(canViewOrgWideAiTasks(owner), true);
    assert.equal(canViewOrgWideAiTasks(admin), true);
    assert.equal(canViewOrgWideAiTasks(member), false);
  });

  it("lets a Member see only the tasks they requested", () => {
    const ownTask = { requestingUserId: member.id };
    const foreignTask = { requestingUserId: otherMember.id };

    assert.equal(canViewAiTask(member, ownTask), true);
    assert.equal(canViewAiTask(member, foreignTask), false);
  });

  it("lets an Owner or Admin see any task", () => {
    assert.equal(canViewAiTask(owner, { requestingUserId: otherMember.id }), true);
    assert.equal(canViewAiTask(admin, { requestingUserId: member.id }), true);
  });

  it("applies the same rule when operating a task", () => {
    const foreignTask = { requestingUserId: otherMember.id };

    assert.equal(canOperateAiTask(member, { requestingUserId: member.id }), true);
    assert.equal(canOperateAiTask(member, foreignTask), false);
    assert.equal(canOperateAiTask(admin, foreignTask), true);
  });

  it("keeps AI conversations private to their owner at every role", () => {
    const ownConversation = { userId: member.id };

    assert.equal(canViewAiConversation(member, ownConversation), true);
    assert.equal(canViewAiConversation(owner, ownConversation), false);
    assert.equal(canViewAiConversation(admin, ownConversation), false);
  });

  it("builds a scoped list filter for Members and an open filter for admins", () => {
    assert.deepEqual(aiTaskVisibilityWhere(member), { requestingUserId: member.id });
    assert.deepEqual(aiTaskVisibilityWhere(owner), {});
    assert.deepEqual(aiTaskVisibilityWhere(admin), {});
  });
});

describe("Failed task retry transitions", () => {
  it("allows the retry sequence the task runner now uses", () => {
    assert.equal(canTransition("FAILED", "READY"), true);
    assert.equal(canTransition("READY", "RUNNING"), true);
  });

  it("does not allow FAILED -> RUNNING, which is why failed steps are re-armed first", () => {
    assert.equal(canTransition("FAILED", "RUNNING"), false);
  });

  it("allows a re-armed step to run to completion", () => {
    assert.equal(canTransition("FAILED", "READY"), true);
    assert.equal(canTransition("READY", "RUNNING"), true);
    assert.equal(canTransition("RUNNING", "COMPLETED"), true);
  });
});
