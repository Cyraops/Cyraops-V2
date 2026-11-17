import type { Prisma } from "@prisma/client";

type MailboxUser = { id: string; role: string };

function isMailboxAdmin(user: MailboxUser) {
  return user.role === "OWNER" || user.role === "ADMIN";
}

/** Members share the corporate mailbox; only drafts remain private to their author. */
export function emailFolderVisibilityWhere(
  user: MailboxUser,
  folderType: string,
): Prisma.EmailMessageWhereInput {
  if (isMailboxAdmin(user)) return {};
  if (folderType.toUpperCase() === "DRAFTS") {
    return { isDraft: true, userId: user.id };
  }
  return { isDraft: false };
}

export function emailMessageVisibilityWhere(user: MailboxUser): Prisma.EmailMessageWhereInput {
  if (isMailboxAdmin(user)) return {};
  return {
    OR: [{ isDraft: false }, { isDraft: true, userId: user.id }],
  };
}

export function canReadMailboxMessage(
  user: MailboxUser,
  message: { isDraft: boolean; userId: string | null },
) {
  return isMailboxAdmin(user) || !message.isDraft || message.userId === user.id;
}

export function canPermanentlyDeleteSharedMail(user: MailboxUser) {
  return isMailboxAdmin(user);
}
