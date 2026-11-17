import assert from "node:assert/strict";
import test from "node:test";
import {
  canPermanentlyDeleteSharedMail,
  canReadMailboxMessage,
  emailFolderVisibilityWhere,
  emailMessageVisibilityWhere,
} from "./access";

test("team members share non-draft mailbox messages but keep drafts private", () => {
  const member = { id: "member-1", role: "MEMBER" };

  assert.deepEqual(emailFolderVisibilityWhere(member, "INBOX"), { isDraft: false });
  assert.deepEqual(emailFolderVisibilityWhere(member, "DRAFTS"), {
    isDraft: true,
    userId: "member-1",
  });
  assert.deepEqual(emailMessageVisibilityWhere(member), {
    OR: [{ isDraft: false }, { isDraft: true, userId: "member-1" }],
  });
  assert.equal(canReadMailboxMessage(member, { isDraft: false, userId: null }), true);
  assert.equal(canReadMailboxMessage(member, { isDraft: true, userId: "member-2" }), false);
  assert.equal(canReadMailboxMessage(member, { isDraft: true, userId: "member-1" }), true);
});

test("only owners and admins can permanently delete shared mailbox mail", () => {
  assert.equal(canPermanentlyDeleteSharedMail({ id: "owner-1", role: "OWNER" }), true);
  assert.equal(canPermanentlyDeleteSharedMail({ id: "admin-1", role: "ADMIN" }), true);
  assert.equal(canPermanentlyDeleteSharedMail({ id: "member-1", role: "MEMBER" }), false);
});
