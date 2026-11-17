import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLoginCredential, type LegacyWorkspaceCredential, type LoginUserRecord } from "./login-credentials";

const owner: LoginUserRecord = {
  id: "owner-1",
  role: "OWNER",
  passwordHash: null,
  disabledAt: null,
  mustChangePassword: false,
};

const legacyWorkspace: LegacyWorkspaceCredential = {
  loginEmail: "owner@example.com",
  loginPasswordHash: "legacy-hash",
  owner,
};

describe("legacy Owner login compatibility", () => {
  it("uses the existing workspace credential for an active Owner without a user password", () => {
    const candidate = resolveLoginCredential(null, legacyWorkspace, "owner@example.com");
    assert.equal(candidate?.user.id, owner.id);
    assert.equal(candidate?.passwordHash, legacyWorkspace.loginPasswordHash);
  });

  it("does not use the workspace credential for another email", () => {
    assert.equal(resolveLoginCredential(null, legacyWorkspace, "other@example.com"), null);
  });

  it("does not use a legacy credential for a disabled or non-Owner account", () => {
    assert.equal(resolveLoginCredential(null, { ...legacyWorkspace, owner: { ...owner, disabledAt: new Date() } }, "owner@example.com"), null);
    assert.equal(resolveLoginCredential(null, { ...legacyWorkspace, owner: { ...owner, role: "ADMIN" } }, "owner@example.com"), null);
  });

  it("does not use a stale workspace hash once the Owner has a per-user password", () => {
    assert.equal(resolveLoginCredential(null, { ...legacyWorkspace, owner: { ...owner, passwordHash: "current-hash" } }, "owner@example.com"), null);
  });

  it("preserves the account's current credential candidate when a user record exists", () => {
    const member = { ...owner, id: "member-1", role: "MEMBER", passwordHash: "member-hash" };
    const candidate = resolveLoginCredential(member, legacyWorkspace, "owner@example.com");
    assert.equal(candidate?.user.id, member.id);
    assert.equal(candidate?.passwordHash, member.passwordHash);
  });
});
