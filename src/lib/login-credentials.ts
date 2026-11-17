export type LoginUserRecord = {
  id: string;
  role: string;
  passwordHash: string | null;
  disabledAt: Date | null;
  mustChangePassword: boolean;
};

export type LegacyWorkspaceCredential = {
  loginEmail: string;
  loginPasswordHash: string;
  owner: LoginUserRecord;
};

export type LoginCredential = {
  user: LoginUserRecord;
  passwordHash: string | null;
};

/**
 * Preserve the original workspace credential only for an active Owner account
 * that has not yet received a per-user password. Once an Owner has a modern
 * password, the legacy workspace hash can no longer authenticate them.
 */
export function resolveLoginCredential(
  user: LoginUserRecord | null,
  legacyWorkspace: LegacyWorkspaceCredential | null,
  normalizedEmail: string,
): LoginCredential | null {
  if (user) return { user, passwordHash: user.passwordHash };

  const submittedEmail = normalizedEmail.trim().toLowerCase();
  if (!legacyWorkspace || legacyWorkspace.loginEmail.trim().toLowerCase() !== submittedEmail) return null;

  const owner = legacyWorkspace.owner;
  if (owner.role !== "OWNER" || owner.disabledAt || owner.passwordHash || !legacyWorkspace.loginPasswordHash) return null;

  return { user: owner, passwordHash: legacyWorkspace.loginPasswordHash };
}
