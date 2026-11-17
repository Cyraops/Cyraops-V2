import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canManageMember, hasProjectAccess } from "./permissions";
import { emailSchema, passwordSchema, taskStatusSchema } from "./validators";

describe("team role policy", () => {
  it("prevents admins from managing other admins or the owner", () => {
    assert.equal(canManageMember("ADMIN", "MEMBER", "MEMBER"), true);
    assert.equal(canManageMember("ADMIN", "MEMBER", "ADMIN"), false);
    assert.equal(canManageMember("ADMIN", "ADMIN", "MEMBER"), false);
    assert.equal(canManageMember("OWNER", "ADMIN", "MEMBER"), true);
    assert.equal(canManageMember("MEMBER", "MEMBER", "MEMBER"), false);
    assert.equal(canManageMember("OWNER", "OWNER", "ADMIN"), false);
  });

  it("grants workspace-wide project visibility only to owners and admins", () => {
    assert.equal(hasProjectAccess("OWNER", false), true);
    assert.equal(hasProjectAccess("ADMIN", false), true);
    assert.equal(hasProjectAccess("MEMBER", false), false);
    assert.equal(hasProjectAccess("MEMBER", true), true);
  });
});

describe("input validation", () => {
  it("normalizes company emails", () => {
    assert.equal(emailSchema.parse("  TEAM@EXAMPLE.COM "), "team@example.com");
    assert.equal(emailSchema.safeParse("not-an-email").success, false);
  });

  it("rejects short passwords and unknown task states", () => {
    assert.equal(passwordSchema.safeParse("abc").success, false);
    assert.equal(passwordSchema.safeParse("short-pass").success, false);
    assert.equal(passwordSchema.safeParse("under12char").success, false);
    assert.equal(passwordSchema.safeParse("secure-corporate-password-123").success, true);
    assert.equal(taskStatusSchema.safeParse("NOT_A_STATUS").success, false);
  });
});
