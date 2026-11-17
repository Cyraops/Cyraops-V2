"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Inbox,
  Send,
  FileEdit,
  Star,
  Archive,
  AlertOctagon,
  Trash2,
  Search,
  RefreshCw,
  Plus,
  Paperclip,
  Reply,
  ReplyAll,
  Forward,
  Printer,
  Sparkles,
  UserCheck,
  Loader2,
  Mail,
  X,
  ShieldAlert,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import { Avatar, Button, Modal, useToast } from "@/components/ui";

interface Folder {
  id: string;
  name: string;
  type: string;
  unreadCount: number;
  totalCount: number;
}

interface EmailItem {
  id: string;
  messageId?: string;
  fromName?: string;
  fromEmail: string;
  toRecipients: string;
  subject: string;
  snippet?: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  sentAt?: string;
  receivedAt: string;
  sizeBytes: number;
  folder?: { id: string; name: string; type: string };
}

interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

interface EmailDetail extends EmailItem {
  bodyText?: string;
  bodyHtml?: string;
  ccRecipients?: string;
  bccRecipients?: string;
  replyTo?: string;
  attachments?: Attachment[];
}

interface CrmMatch {
  type: "contact" | "lead" | "company";
  name: string;
  id: string;
  details?: string;
}

interface AccountInfo {
  id: string;
  email: string;
  name: string;
  isConfigured: boolean;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  lastSyncedAt?: string;
  lastError?: string;
}

export function EmailModule() {
  const toast = useToast();

  // State
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>("INBOX");
  const [messages, setMessages] = useState<EmailItem[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailDetail | null>(null);
  const [crmMatch, setCrmMatch] = useState<CrmMatch | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);

  // UI state
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allowedRemoteImagesForId, setAllowedRemoteImagesForId] = useState<string | null>(null);
  const showRemoteImages = Boolean(selectedMessageId && allowedRemoteImagesForId === selectedMessageId);

  // Compose State
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; size: number; type: string; content: string }[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const DANGEROUS = /\.(exe|bat|cmd|sh|vbs|scr|com|pif|msi|jar|ps1|hta|reg)$/i;
    const currentTotal = composeAttachments.reduce((acc, a) => acc + a.size, 0);
    let newTotal = currentTotal;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (DANGEROUS.test(file.name)) {
        toast(`Dangerous attachment blocked: ${file.name}`, "error");
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast(`File "${file.name}" exceeds 20MB limit`, "error");
        continue;
      }
      if (newTotal + file.size > 25 * 1024 * 1024) {
        toast("Total attachment limit (25MB) reached", "error");
        break;
      }

      newTotal += file.size;

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setComposeAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
            content: base64,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeComposeAttachment = (index: number) => {
    setComposeAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // AI Assistant State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiDraftReply, setAiDraftReply] = useState<string | null>(null);
  const [aiTasks, setAiTasks] = useState<string | null>(null);
  const [aiTone, setAiTone] = useState<"formal" | "direct" | "detailed" | "friendly">("formal");

  // Fetch emails list
  const loadEmails = useCallback(async (folderType = currentFolder, search = searchQuery, unread = unreadOnly, starred = starredOnly) => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (starred) {
        params.set("starred", "true");
      } else {
        params.set("folder", folderType);
      }
      if (search) params.set("q", search);
      if (unread) params.set("unread", "true");

      const res = await fetch(`/api/email?${params.toString()}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setAccount(data.account || null);
      setFolders(data.folders || []);
      setMessages(data.messages || []);

      // If previously selected email is no longer in list, clear detail
      if (selectedMessageId && !data.messages.some((m: EmailItem) => m.id === selectedMessageId)) {
        // Keep detail if viewing
      }
    } catch (err: any) {
      toast(err.message || "Failed to load emails", "error");
    } finally {
      setLoadingList(false);
    }
  }, [currentFolder, searchQuery, unreadOnly, starredOnly, toast, selectedMessageId]);

  // Load single email detail
  const loadEmailDetail = async (id: string) => {
    setLoadingDetail(true);
    setSelectedMessageId(id);
    setAllowedRemoteImagesForId(null);
    setAiSummary(null);
    setAiDraftReply(null);
    setAiTasks(null);

    try {
      const res = await fetch(`/api/email/${id}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setEmailDetail(data.message);
      setCrmMatch(data.crmMatch || null);

      // Update unread status in list
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isRead: true } : m))
      );

      // Update folder unread badge count
      setFolders((prev) =>
        prev.map((f) => {
          if (f.type === currentFolder && f.unreadCount > 0) {
            return { ...f, unreadCount: f.unreadCount - 1 };
          }
          return f;
        })
      );
    } catch (err: any) {
      toast(err.message || "Failed to load email details", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => setCurrentUser(data?.user || null))
      .catch((err) => console.error(err));
    void loadEmails();
  }, [loadEmails]);

  // Synchronize with GoDaddy mailbox
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/email/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: currentFolder === "SENT" ? "Sent" : "INBOX" }),
      });
      const data = await res.json();

      if (!data.ok) {
        if (!data.isConfigured) {
          setConfigModalOpen(true);
        }
        toast(data.message || data.error || "Mailbox synchronization issue", "error");
      } else {
        toast(data.message || `Synchronized ${data.syncedCount} new messages`, "success");
        await loadEmails();
      }
    } catch {
      toast("Failed to reach email sync service", "error");
    } finally {
      setSyncing(false);
    }
  };

  // Single or bulk message actions
  const handleAction = async (action: "markRead" | "markUnread" | "toggleStar" | "archive" | "trash" | "deletePermanent", messageId: string) => {
    try {
      const res = await fetch("/api/email/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageIds: [messageId] }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      if (action === "toggleStar") {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isStarred: !m.isStarred } : m))
        );
        if (emailDetail && emailDetail.id === messageId) {
          setEmailDetail({ ...emailDetail, isStarred: !emailDetail.isStarred });
        }
      } else if (action === "markRead" || action === "markUnread") {
        const isRead = action === "markRead";
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isRead } : m))
        );
        if (emailDetail && emailDetail.id === messageId) {
          setEmailDetail({ ...emailDetail, isRead });
        }
      } else {
        // Remove from current view
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        if (selectedMessageId === messageId) {
          setSelectedMessageId(null);
          setEmailDetail(null);
        }
        toast(action === "trash" ? "Message moved to trash" : "Message archived", "success");
      }
    } catch (err: any) {
      toast(err.message || "Action failed", "error");
    }
  };

  // Send Email Handler
  const handleSendEmail = async () => {
    if (!composeTo.trim()) {
      toast("Please specify at least one recipient email address", "error");
      return;
    }

    const recipients = composeTo
      .split(/[,;\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);

    const ccList = composeCc
      ? composeCc.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean)
      : undefined;

    const bccList = composeBcc
      ? composeBcc.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean)
      : undefined;

    setSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipients,
          cc: ccList,
          bcc: bccList,
          subject: composeSubject.trim() || "(No Subject)",
          bodyText: composeBody,
          bodyHtml: composeBody.replace(/\n/g, "<br/>"),
          inReplyTo,
          idempotencyKey: `send_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          attachments: composeAttachments.map((a) => ({
            filename: a.name,
            contentType: a.type,
            content: a.content,
          })),
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      toast("Email transmitted successfully via GoDaddy SMTP", "success");
      setComposeOpen(false);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      setInReplyTo(undefined);
      setComposeAttachments([]);

      // If in Sent folder, refresh list
      if (currentFolder === "SENT") {
        await loadEmails();
      }
    } catch (err: any) {
      toast(err.message || "Failed to send email", "error");
    } finally {
      setSending(false);
    }
  };

  // Reply handlers
  const handleReply = (replyAll = false) => {
    if (!emailDetail) return;

    setComposeTo(emailDetail.fromEmail);
    if (replyAll) {
      try {
        const toList = JSON.parse(emailDetail.toRecipients || "[]");
        const ccList = JSON.parse(emailDetail.ccRecipients || "[]");
        const combined = [...toList, ...ccList].filter(
          (addr) => addr && addr.toLowerCase() !== account?.email?.toLowerCase() && addr !== emailDetail.fromEmail
        );
        if (combined.length > 0) {
          setComposeCc(combined.join(", "));
          setShowCcBcc(true);
        }
      } catch {
        // ignore
      }
    }

    const prefix = emailDetail.subject.toLowerCase().startsWith("re:") ? "" : "Re: ";
    setComposeSubject(`${prefix}${emailDetail.subject}`);
    setComposeBody(`\n\n--- On ${new Date(emailDetail.receivedAt).toLocaleString()}, ${emailDetail.fromName || emailDetail.fromEmail} wrote:\n> ${(emailDetail.bodyText || "").slice(0, 500).replace(/\n/g, "\n> ")}`);
    setInReplyTo(emailDetail.messageId);
    setComposeOpen(true);
  };

  const handleForward = () => {
    if (!emailDetail) return;
    setComposeTo("");
    const prefix = emailDetail.subject.toLowerCase().startsWith("fwd:") ? "" : "Fwd: ";
    setComposeSubject(`${prefix}${emailDetail.subject}`);
    setComposeBody(`\n\n---------- Forwarded message ---------\nFrom: ${emailDetail.fromName || ""} <${emailDetail.fromEmail}>\nDate: ${new Date(emailDetail.receivedAt).toLocaleString()}\nSubject: ${emailDetail.subject}\nTo: ${emailDetail.toRecipients}\n\n${emailDetail.bodyText || ""}`);
    setComposeOpen(true);
  };

  // AI Assistant Actions
  const handleAiAction = async (action: "summarize" | "draft_reply" | "extract_tasks" | "convert_to_task") => {
    if (!emailDetail) return;
    setAiLoading(true);

    try {
      const res = await fetch("/api/email/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          emailSubject: emailDetail.subject,
          emailBody: emailDetail.bodyText || emailDetail.snippet || "",
          sender: `${emailDetail.fromName || ""} <${emailDetail.fromEmail}>`,
          tone: aiTone,
          messageId: emailDetail.id,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      if (action === "summarize") {
        setAiSummary(data.summary);
      } else if (action === "draft_reply") {
        setAiDraftReply(data.draftReply);
      } else if (action === "extract_tasks") {
        setAiTasks(data.actionItems);
      } else if (action === "convert_to_task") {
        toast(data.message || "Task created successfully", "success");
      }
    } catch (err: any) {
      toast(err.message || "AI email assistant request failed", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const useAiReplyInCompose = () => {
    if (!aiDraftReply || !emailDetail) return;
    handleReply(false);
    setComposeBody(aiDraftReply);
  };

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col rounded-2xl border border-[var(--border)] bg-white dark:bg-neutral-950 shadow-soft overflow-hidden sm:min-h-[640px]">
      {/* 3-Panel Layout Container */}
      {/* Mobile bar: folder switch + compose, since the rail is hidden on small screens */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-neutral-50/70 p-2 dark:bg-neutral-900/40 md:hidden">
        <select
          value={starredOnly ? "STARRED" : currentFolder}
          onChange={(event) => {
            if (event.target.value === "STARRED") {
              setStarredOnly(true);
            } else {
              setStarredOnly(false);
              setCurrentFolder(event.target.value);
            }
            setSelectedMessageId(null);
            setEmailDetail(null);
          }}
          className="h-8 flex-1 rounded-lg border border-[var(--border)] bg-white px-2 text-xs dark:bg-neutral-900"
          aria-label="Folder"
        >
          <option value="STARRED">Starred</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.type}>
              {folder.name}{folder.unreadCount ? ` (${folder.unreadCount})` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setComposeOpen(true)}
          className="h-8 rounded-lg bg-accent px-3 text-xs font-bold text-white"
        >
          Compose
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden divide-x divide-[var(--border)]">
        {/* ================================================================= */}
        {/* LEFT PANEL: FOLDERS & STATUS */}
        {/* ================================================================= */}
        <div className="hidden w-56 shrink-0 flex-col justify-between bg-neutral-50/70 p-3 select-none dark:bg-neutral-900/40 md:flex">
          <div className="space-y-4">
            {/* Compose Button */}
            <button
              onClick={() => {
                setComposeTo("");
                setComposeCc("");
                setComposeBcc("");
                setComposeSubject("");
                setComposeBody("");
                setComposeAttachments([]);
                setInReplyTo(undefined);
                setComposeOpen(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#5345cc] transition-colors"
            >
              <Plus size={16} />
              <span>Compose</span>
            </button>

            {/* Folder Navigation */}
            <div className="space-y-0.5">
              {[
                { type: "INBOX", label: "Inbox", icon: Inbox },
                { type: "SENT", label: "Sent", icon: Send },
                { type: "DRAFTS", label: "Drafts", icon: FileEdit },
                { type: "STARRED", label: "Starred", icon: Star },
                { type: "ARCHIVE", label: "Archive", icon: Archive },
                { type: "SPAM", label: "Spam", icon: AlertOctagon },
                { type: "TRASH", label: "Trash", icon: Trash2 },
              ].map((f) => {
                const Icon = f.icon;
                const folderObj = folders.find((item) => item.type === f.type);
                const unread = folderObj?.unreadCount || 0;
                const isActive = (f.type === "STARRED" && starredOnly) || (!starredOnly && currentFolder === f.type);

                return (
                  <button
                    key={f.type}
                    onClick={() => {
                      if (f.type === "STARRED") {
                        setStarredOnly(true);
                      } else {
                        setStarredOnly(false);
                        setCurrentFolder(f.type);
                      }
                      setSelectedMessageId(null);
                      setEmailDetail(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-accent/10 text-accent font-bold"
                        : "text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon size={15} className={isActive ? "text-accent" : "text-neutral-500"} />
                      <span>{f.label}</span>
                    </div>
                    {unread > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-0.2 text-[10px] font-bold text-white">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mailbox Provider & Sync Status Card */}
          <div className="rounded-xl border border-[var(--border)] bg-white dark:bg-neutral-900 p-3 space-y-2 text-xs shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-neutral-800 dark:text-neutral-200 text-[11px]">
                <Mail size={13} className="text-accent" />
                <span>GoDaddy Mailbox</span>
              </div>
              <span
                className={`h-2 w-2 rounded-full ${
                  account?.isConfigured ? "bg-emerald-500" : "bg-amber-500"
                }`}
                title={account?.isConfigured ? "Connected" : "Mailbox not configured"}
              />
            </div>

            <div className="text-[10px] text-neutral-500 truncate" title={account?.email}>
              {account?.isConfigured ? account.email : "Mailbox not configured"}
            </div>

            {currentUser?.role !== "MEMBER" && (
              <div className="pt-1 flex items-center justify-between gap-1">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
                >
                  <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
                  <span>{syncing ? "Syncing..." : "Sync Mailbox"}</span>
                </button>
                <button
                  onClick={() => setConfigModalOpen(true)}
                  className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  Settings
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ================================================================= */}
        {/* MIDDLE PANEL: EMAIL LIST */}
        {/* ================================================================= */}
        <div className={`${selectedMessageId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col overflow-hidden bg-white dark:bg-neutral-950 md:w-80 lg:w-96`}>
          {/* List Search & Controls */}
          <div className="p-3 border-b border-[var(--border)] space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
              <input
                type="text"
                placeholder="Search mail..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadEmails();
                }}
                className="w-full h-8 pl-8 pr-3 rounded-lg border border-[var(--border)] bg-neutral-50 dark:bg-neutral-900 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-neutral-500">
              <div className="font-semibold text-neutral-700 dark:text-neutral-300 capitalize text-[11px]">
                {starredOnly ? "Starred Messages" : currentFolder.toLowerCase()} ({messages.length})
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setUnreadOnly(!unreadOnly)}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors ${
                    unreadOnly ? "bg-accent text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  Unread
                </button>
                <button
                  onClick={() => void loadEmails()}
                  title="Refresh list"
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-0.5"
                >
                  <RefreshCw size={12} className={loadingList ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          </div>

          {/* Email Messages Scrollable List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {loadingList ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="animate-pulse space-y-1.5 py-2">
                    <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3" />
                    <div className="h-3.5 bg-neutral-200 dark:bg-neutral-800 rounded w-3/4" />
                    <div className="h-2.5 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400 space-y-2">
                <Inbox className="mx-auto h-8 w-8 text-neutral-300" />
                <div className="font-semibold text-neutral-600 dark:text-neutral-400">No emails found</div>
                <p className="text-[11px]">
                  {account?.isConfigured
                    ? "Your mailbox is synchronized and up-to-date."
                    : "The Owner must finish setting up the shared GoDaddy mailbox before live mail can sync."}
                </p>
                {!account?.isConfigured && (
                  <button
                    onClick={() => setConfigModalOpen(true)}
                    className="mt-2 text-accent font-semibold underline text-xs"
                  >
                    View setup guide
                  </button>
                )}
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = selectedMessageId === msg.id;
                const formattedDate = new Date(msg.receivedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });

                return (
                  <div
                    key={msg.id}
                    onClick={() => void loadEmailDetail(msg.id)}
                    className={`p-3 cursor-pointer transition-colors text-left flex flex-col gap-1 ${
                      isSelected
                        ? "bg-accent/10 border-l-4 border-l-accent"
                        : msg.isRead
                        ? "hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
                        : "bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 truncate">
                        {!msg.isRead && (
                          <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                        )}
                        <span
                          className={`truncate text-xs ${
                            msg.isRead
                              ? "text-neutral-700 dark:text-neutral-300 font-medium"
                              : "text-neutral-900 dark:text-neutral-100 font-bold"
                          }`}
                        >
                          {currentFolder === "SENT" ? `To: ${msg.toRecipients}` : msg.fromName || msg.fromEmail}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {msg.hasAttachments && (
                          <Paperclip size={11} className="text-neutral-400 shrink-0" />
                        )}
                        <span className="text-[10px] text-neutral-400">{formattedDate}</span>
                      </div>
                    </div>

                    <div
                      className={`text-xs truncate ${
                        msg.isRead
                          ? "text-neutral-800 dark:text-neutral-200"
                          : "text-neutral-900 dark:text-neutral-100 font-semibold"
                      }`}
                    >
                      {msg.subject || "(No Subject)"}
                    </div>

                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                      {msg.snippet || "No preview content"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ================================================================= */}
        {/* RIGHT / MAIN PANEL: EMAIL DETAIL & READER */}
        {/* ================================================================= */}
        <div className={`${selectedMessageId ? "flex" : "hidden md:flex"} flex-1 flex-col overflow-hidden bg-white dark:bg-neutral-950`}>
          {loadingDetail ? (
            <div className="flex-1 flex items-center justify-center text-xs text-neutral-400 gap-2">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span>Loading email message...</span>
            </div>
          ) : !emailDetail ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-neutral-400 space-y-3">
              <Mail className="h-12 w-12 text-neutral-300 dark:text-neutral-700" />
              <div className="font-semibold text-neutral-700 dark:text-neutral-300 text-sm">
                Select an email to read
              </div>
              <p className="text-xs text-neutral-400 max-w-sm">
                {account?.isConfigured
                  ? <>Connected to the shared GoDaddy Professional Email (Titan) mailbox via IMAP (<code className="text-neutral-600">imap.secureserver.net:993</code>) and SMTP (<code className="text-neutral-600">smtpout.secureserver.net:465</code>).</>
                  : "The shared GoDaddy mailbox is not configured yet. Once the Owner connects it, incoming and sent mail will be available to the team."}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Mobile back to list */}
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 md:hidden">
                <button
                  onClick={() => { setSelectedMessageId(null); setEmailDetail(null); }}
                  className="flex items-center gap-1 text-xs font-semibold text-accent"
                >
                  <ChevronLeft size={14} /> Back to inbox
                </button>
              </div>
              {/* Email Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5 bg-neutral-50/50 dark:bg-neutral-900/20">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleReply(false)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                    title="Reply"
                  >
                    <Reply size={14} />
                    <span>Reply</span>
                  </button>
                  <button
                    onClick={() => handleReply(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                    title="Reply All"
                  >
                    <ReplyAll size={14} />
                    <span>Reply All</span>
                  </button>
                  <button
                    onClick={handleForward}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
                    title="Forward"
                  >
                    <Forward size={14} />
                    <span>Forward</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void handleAction("toggleStar", emailDetail.id)}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
                    title={emailDetail.isStarred ? "Unstar" : "Star"}
                  >
                    <Star
                      size={15}
                      className={emailDetail.isStarred ? "fill-amber-400 text-amber-500" : ""}
                    />
                  </button>
                  <button
                    onClick={() => void handleAction("archive", emailDetail.id)}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
                    title="Archive"
                  >
                    <Archive size={15} />
                  </button>
                  <button
                    onClick={() => void handleAction("trash", emailDetail.id)}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-rose-600"
                    title="Move to trash"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
                    title="Print email"
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>

              {/* Email Content Container */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Email Subject Header */}
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 leading-snug">
                    {emailDetail.subject || "(No Subject)"}
                  </h1>
                  <span className="shrink-0 text-xs px-2.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 font-medium">
                    {emailDetail.folder?.name || "Inbox"}
                  </span>
                </div>

                {/* Sender & Recipient Information */}
                <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4 text-xs">
                  <div className="flex items-center gap-3">
                    <Avatar name={emailDetail.fromName || emailDetail.fromEmail} size="md" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-neutral-900 dark:text-neutral-100 text-sm">
                          {emailDetail.fromName || emailDetail.fromEmail}
                        </span>
                        <span className="text-neutral-400">&lt;{emailDetail.fromEmail}&gt;</span>
                      </div>
                      <div className="text-neutral-500 mt-0.5">
                        <span>To: {emailDetail.toRecipients}</span>
                        {emailDetail.ccRecipients && (
                          <span className="ml-2">Cc: {emailDetail.ccRecipients}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-neutral-400 shrink-0">
                    <div>{new Date(emailDetail.receivedAt).toLocaleString()}</div>
                    {/* CRM Contact Match Badge */}
                    {crmMatch && (
                      <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                        <UserCheck size={11} />
                        <span>CRM {crmMatch.type.toUpperCase()}: {crmMatch.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Assistant Quick Actions Bar */}
                <div className="rounded-xl border border-purple-200/70 dark:border-purple-900/50 bg-purple-50/40 dark:bg-purple-950/10 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-accent">
                      <Sparkles size={13} />
                      <span>AI Email Assistant</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={aiTone}
                        onChange={(e) => setAiTone(e.target.value as any)}
                        className="h-6 rounded border border-[var(--border)] bg-white dark:bg-neutral-900 px-1 text-[11px] text-neutral-700 dark:text-neutral-300 focus:outline-none"
                        title="Select reply tone"
                      >
                        <option value="formal">Formal</option>
                        <option value="direct">Direct</option>
                        <option value="detailed">Detailed</option>
                        <option value="friendly">Friendly</option>
                      </select>
                      <button
                        onClick={() => void handleAiAction("summarize")}
                        disabled={aiLoading}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-neutral-900 border border-[var(--border)] text-neutral-700 dark:text-neutral-300 hover:border-accent"
                      >
                        Summarize
                      </button>
                      <button
                        onClick={() => void handleAiAction("draft_reply")}
                        disabled={aiLoading}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-neutral-900 border border-[var(--border)] text-neutral-700 dark:text-neutral-300 hover:border-accent"
                      >
                        Draft Reply
                      </button>
                      <button
                        onClick={() => void handleAiAction("extract_tasks")}
                        disabled={aiLoading}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-neutral-900 border border-[var(--border)] text-neutral-700 dark:text-neutral-300 hover:border-accent"
                      >
                        Extract Tasks
                      </button>
                      <button
                        onClick={() => void handleAiAction("convert_to_task")}
                        disabled={aiLoading}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-neutral-900 border border-[var(--border)] text-neutral-700 dark:text-neutral-300 hover:border-accent"
                      >
                        Create CRM Task
                      </button>
                    </div>
                  </div>

                  {aiLoading && (
                    <div className="flex items-center gap-2 pt-2 text-xs text-neutral-500">
                      <Loader2 size={13} className="animate-spin text-accent" />
                      <span>Processing email with Cyraops AI...</span>
                    </div>
                  )}

                  {aiSummary && (
                    <div className="pt-2 text-xs text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30 whitespace-pre-line">
                      <div className="font-bold text-accent mb-1">Executive Summary:</div>
                      {aiSummary}
                    </div>
                  )}

                  {aiDraftReply && (
                    <div className="pt-2 text-xs text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-accent">Suggested Reply Draft:</span>
                        <button
                          onClick={useAiReplyInCompose}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"
                        >
                          <Reply size={12} />
                          <span>Insert into Compose</span>
                        </button>
                      </div>
                      <div className="whitespace-pre-line text-neutral-800 dark:text-neutral-200 bg-neutral-50 dark:bg-neutral-950 p-2 rounded border border-[var(--border)]">
                        {aiDraftReply}
                      </div>
                    </div>
                  )}

                  {aiTasks && (
                    <div className="pt-2 text-xs text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-900 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30 whitespace-pre-line">
                      <div className="font-bold text-accent mb-1">Action Items:</div>
                      {aiTasks}
                    </div>
                  )}
                </div>

                {/* Attachments Section */}
                {emailDetail.attachments && emailDetail.attachments.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] p-3 bg-neutral-50/50 dark:bg-neutral-900/30 space-y-2">
                    <div className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                      <Paperclip size={13} />
                      <span>Attachments ({emailDetail.attachments.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {emailDetail.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={`/api/email/attachments/${att.id}`}
                          download={att.filename}
                          className="flex items-center justify-between p-2 rounded-lg border border-[var(--border)] bg-white dark:bg-neutral-900 hover:bg-neutral-50 text-xs text-neutral-700 dark:text-neutral-200 transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Paperclip size={14} className="text-accent shrink-0" />
                            <span className="truncate font-medium">{att.filename}</span>
                          </div>
                          <span className="text-[10px] text-neutral-400 shrink-0 ml-2">
                            {Math.round(att.sizeBytes / 1024)} KB
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Email Body Viewer - Sandboxed iframe isolates email HTML and prevents DOM XSS */}
                <div className="text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
                  {/* Remote Image Protection Banner */}
                  {emailDetail.bodyHtml && (/<img[^>]+src\s*=\s*["']?\s*(?:https?:)?\/\/[^"'>\s]+/i.test(emailDetail.bodyHtml) || /data-blocked-src/i.test(emailDetail.bodyHtml)) ? (
                    !showRemoteImages ? (
                      <div className="flex items-center justify-between p-2.5 mb-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
                          <span>Remote images in this email have been blocked to protect your privacy and prevent tracking.</span>
                        </div>
                        <Button
                          variant="secondary"
                          className="text-xs shrink-0 ml-3 h-7 px-2.5"
                          onClick={() => setAllowedRemoteImagesForId(emailDetail.id)}
                        >
                          Load Images
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-2 mb-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)] text-xs">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          Remote images loaded.
                        </span>
                        <button
                          onClick={() => setAllowedRemoteImagesForId(null)}
                          className="text-xs text-[var(--muted)] hover:underline ml-2"
                        >
                          Hide Images
                        </button>
                      </div>
                    )
                  ) : null}

                  {emailDetail.bodyHtml ? (
                    <iframe
                      sandbox="allow-popups"
                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #1e293b; margin: 12px; word-break: break-word; } a { color: #2563eb; } img { max-width: 100%; height: auto; }</style></head><body>${
                        showRemoteImages
                          ? emailDetail.bodyHtml.replace(/<img([^>]*)\ssrc\s*=\s*["'][^"']*["']([^>]*)data-blocked-src\s*=\s*["']([^"']+)["']([^>]*)>/gi, '<img$1 src="$3"$2$4>')
                          : emailDetail.bodyHtml.replace(/<img([^>]*)\ssrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']([^>]*)>/gi, (match, before, src, after) => {
                              if (match.includes("data-blocked-src")) return match;
                              return `<img${before} src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='18' height='18' x='3' y='3' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><path d='m21 15-5-5L5 21'/></svg>" data-blocked-src="${src}" alt="[Remote image blocked]" title="Remote image blocked to protect privacy. Click 'Load Images' to display." style="max-width: 100%; border: 1px dashed #94a3b8; border-radius: 4px; padding: 4px;"${after}>`;
                            })
                      }</body></html>`}
                      className="w-full min-h-[450px] h-[550px] rounded-lg border border-[var(--border)] bg-white text-neutral-900"
                      title="Email Content"
                    />
                  ) : (
                    <pre className="font-sans whitespace-pre-wrap break-words">
                      {emailDetail.bodyText || "No content."}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* COMPOSE EMAIL MODAL */}
      {/* ================================================================= */}
      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title={inReplyTo ? "Reply Message" : "New Message"}
        size="max-w-2xl"
      >
        <div className="space-y-3 text-xs">
          {/* To Field */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
            <span className="w-12 text-neutral-500 font-semibold">To:</span>
            <input
              type="text"
              placeholder="recipient@domain.com"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
            />
            <button
              onClick={() => setShowCcBcc(!showCcBcc)}
              className="text-[11px] font-semibold text-accent hover:underline"
            >
              {showCcBcc ? "Hide Cc/Bcc" : "Cc / Bcc"}
            </button>
          </div>

          {/* Optional CC/BCC */}
          {showCcBcc && (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
                <span className="w-12 text-neutral-500 font-semibold">Cc:</span>
                <input
                  type="text"
                  placeholder="comma separated emails"
                  value={composeCc}
                  onChange={(e) => setComposeCc(e.target.value)}
                  className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
                <span className="w-12 text-neutral-500 font-semibold">Bcc:</span>
                <input
                  type="text"
                  placeholder="blind copy emails"
                  value={composeBcc}
                  onChange={(e) => setComposeBcc(e.target.value)}
                  className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Subject Field */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
            <span className="w-12 text-neutral-500 font-semibold">Subject:</span>
            <input
              type="text"
              placeholder="Message subject"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 font-medium placeholder:text-neutral-400 focus:outline-none"
            />
          </div>

          {/* Message Body Field */}
          <div>
            <textarea
              rows={11}
              placeholder="Write your email message here..."
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-neutral-50/50 dark:bg-neutral-900 p-3 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Attached Files List */}
          {composeAttachments.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-semibold text-neutral-500">
                Attachments ({composeAttachments.length}):
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {composeAttachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[11px] text-neutral-700 dark:text-neutral-200 border border-[var(--border)]"
                  >
                    <Paperclip size={11} className="text-accent" />
                    <span className="truncate max-w-[160px] font-medium">{att.name}</span>
                    <span className="text-[10px] text-neutral-400">
                      ({Math.round(att.size / 1024)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => removeComposeAttachment(idx)}
                      className="text-neutral-400 hover:text-rose-500 ml-1"
                      title="Remove attachment"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compose Footer Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:border-accent text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 transition-colors"
                title="Attach files (Max 20MB per file, 25MB total)"
              >
                <Paperclip size={12} className="text-neutral-500" />
                <span>Attach Files</span>
              </button>

              <button
                onClick={async () => {
                  if (!composeBody.trim()) {
                    toast("Please write some text to improve", "error");
                    return;
                  }
                  try {
                    const res = await fetch("/api/email/ai", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "improve_writing", prompt: composeBody }),
                    });
                    const data = await res.json();
                    if (data.improvedText) {
                      setComposeBody(data.improvedText);
                      toast("Draft polished by AI assistant", "success");
                    }
                  } catch {
                    toast("Failed to improve writing", "error");
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:border-accent text-[11px] font-semibold text-accent transition-colors"
                title="Improve clarity & polish writing"
              >
                <Sparkles size={12} />
                <span>Polish Draft</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setComposeOpen(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSendEmail}
                disabled={sending}
              >
                {sending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Sending via SMTP...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Send Message</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ================================================================= */}
      {/* GODADDY MAILBOX CONFIGURATION MODAL */}
      {/* ================================================================= */}
      <Modal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        title="GoDaddy Company Mailbox Setup"
        size="max-w-lg"
      >
        <div className="space-y-4 text-xs text-neutral-700 dark:text-neutral-300">
          <p>
            Cyraops CRM connects one shared GoDaddy Professional Email (Titan) mailbox for the team. Team members continue to sign in with their own CRM accounts; messages are sent from the shared Cyraops address.
          </p>

          <div className="rounded-xl border border-[var(--border)] bg-neutral-50 dark:bg-neutral-900 p-3.5 space-y-2 font-mono text-[11px]">
            <div className="text-neutral-500 font-sans font-bold">GoDaddy server settings:</div>
            <div>Incoming (IMAP): <span className="text-accent font-bold">imap.secureserver.net:993</span> (SSL)</div>
            <div>Outgoing (SMTP): <span className="text-accent font-bold">smtpout.secureserver.net:465</span> (SSL)</div>
            <div>Active Mailbox: <span className="text-neutral-900 dark:text-neutral-100 font-bold">{account?.isConfigured ? account.email : "Not configured"}</span></div>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-neutral-900 dark:text-neutral-100">To connect the production mailbox:</div>
            <p>Add <code>GODADDY_EMAIL_ADDRESS</code> and the mailbox password as server-side settings on the Azure Container App. Keep the password in Container App Secrets; it is shared by the mail service, not by CRM users.</p>
            <p>For local development only, use the equivalent variables in the development <code>.env</code> file:</p>
            <pre className="p-2.5 rounded-lg bg-neutral-900 text-neutral-100 text-[10px] overflow-x-auto">
{`GODADDY_EMAIL_ADDRESS="your-mailbox@cyraops.com"
GODADDY_EMAIL_PASSWORD="<mailbox-password>"`}
            </pre>
            <p className="text-[11px] text-neutral-400">
              Use the mailbox password set for the Titan email account, not your GoDaddy account password. Incoming mail sync runs in the background every 5 minutes.
            </p>
          </div>

          <div className="pt-2 flex justify-end">
            <Button variant="primary" onClick={() => setConfigModalOpen(false)}>
              Got it
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
