export interface MailboxConfig {
  email: string;
  name: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  isConfigured: boolean;
}

export function getMailboxConfig(): { config: MailboxConfig; password?: string } {
  const email = process.env.GODADDY_EMAIL_ADDRESS?.trim() || "";
  const password = process.env.GODADDY_EMAIL_PASSWORD?.trim() || "";
  const imapHost = process.env.GODADDY_IMAP_HOST?.trim() || "imap.secureserver.net";
  const imapPort = parseInt(process.env.GODADDY_IMAP_PORT?.trim() || "993", 10);
  const smtpHost = process.env.GODADDY_SMTP_HOST?.trim() || "smtpout.secureserver.net";
  const smtpPort = parseInt(process.env.GODADDY_SMTP_PORT?.trim() || "465", 10);

  const isConfigured = Boolean(email && password);

  return {
    config: {
      email: email || "unconfigured@cyraops.com",
      name: "Cyraops Mail",
      imapHost,
      imapPort,
      imapTls: true,
      smtpHost,
      smtpPort,
      smtpTls: true,
      isConfigured,
    },
    password: password || undefined,
  };
}

