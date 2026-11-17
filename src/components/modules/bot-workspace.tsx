"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, Loader2, Clock, Copy, CornerDownLeft, FileText, Globe, MessageSquare, Mic, MicOff, Paperclip, Plus, RefreshCw, Sparkles, Square, Trash2, Users, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { RoutinesModal } from "@/components/routines/routines-modal";
import { Markdown } from "@/components/ai/markdown";
import { parseToolSteps, ToolActivity, type ToolStep } from "@/components/ai/tool-activity";
import { PagesBrowser, PagesPanel, type OpenPage, type PageMeta } from "@/components/ai/pages-panel";
import { BrowserPanel } from "@/components/ai/browser-panel";
import { VoiceMode } from "@/components/ai/voice-mode";
import { LocalBrowserAgent } from "@/components/ai/local-browser-agent";
import { CommandPalette } from "@/components/ai/command-palette";
import { AskBlock, FileBlock, StepBlock, TextBlock, toBlocks } from "@/components/ai/blocks";
import { BotOrb } from "@/components/ai/bot-avatar";
import { Button, Field, Modal, Textarea, useToast } from "@/components/ui";

const SELECTION_KEY = "cyraops:bot:row";

interface ChatItem {
  id: string;
  /** Set on optimistic rows so a failed send can find and remove them. */
  clientId?: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: string | null;
  attachments?: string | null;
  createdAt?: string;
  /** True only while this reply is still arriving. */
  streaming?: boolean;
  /** Wall-clock time the turn's tools took. */
  toolDurationMs?: number;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

/** Create a bot from blank or from a template, and edit a bot you own. */
function BotDialog({
  mode,
  agent,
  template,
  teammates,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  agent?: any;
  template?: string;
  teammates: Array<any>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const templates = teammates.filter((mate) => mate.isTemplate);
  const [chosen, setChosen] = useState<string>(template ?? "");
  const [tools, setTools] = useState<string[]>(agent?.tools ?? []);
  const [busy, setBusy] = useState(false);

  const abilities: Array<[string, string]> = [
    ["search_contacts", "Find contacts"], ["search_companies", "Find companies"],
    ["search_leads", "Find leads"], ["create_lead", "Create leads"], ["update_lead", "Update leads"],
    ["search_deals", "Find deals"], ["create_deal", "Create deals"], ["update_deal", "Update deals"],
    ["search_tasks", "Find tickets"], ["create_task", "Create tickets"], ["update_task", "Triage tickets"],
    ["send_email", "Send email"], ["search_emails", "Search the mailbox"],
    ["list_schedule", "Read the schedule"], ["create_event", "Book meetings"],
    ["create_page", "Build documents"], ["analyse_table", "Analyse spreadsheets"],
    ["browser_navigate", "Browse the web"], ["browser_extract", "Read web pages"],
    ["create_routine", "Create routines"], ["remember", "Remember facts"],
    ["create_contact", "Create contacts"], ["qualify_lead", "Qualify leads"],
  ];

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const role = String(f.get("role") ?? "").trim();
    if (!name || !role) return toast("A bot needs a name and a role", "error");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        role,
        description: String(f.get("description") ?? ""),
        systemPrompt: String(f.get("instructions") ?? ""),
        tools,
      };
      const response = await fetch(
        mode === "create" ? "/api/ai/agents" : `/api/ai/agents/${agent.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "create" ? { ...payload, templateSlug: chosen || undefined } : payload),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the bot");
      onSaved(mode === "create" ? `${name} is on the team` : `${name} updated`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the bot", "error");
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ai/agents/${agent.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not retire the bot");
      onSaved(data.deleted ? `${agent.name} was retired` : `${agent.name} was paused`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not retire the bot", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === "create" ? "New bot" : `Edit ${agent?.name ?? "bot"}`} size="max-w-2xl">
      <form onSubmit={submit} className="space-y-3">
        {mode === "create" && templates.length > 0 && (
          <div>
            <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">Start from</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setChosen("")}
                className={`rounded-lg border px-2.5 py-1.5 text-caption font-semibold transition ${chosen === "" ? "border-accent bg-accent/10 text-accent" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}
              >
                Blank bot
              </button>
              {templates.map((mate) => (
                <button
                  key={mate.slug}
                  type="button"
                  onClick={() => {
                    setChosen(mate.slug);
                    setTools(Array.isArray(mate.tools) ? mate.tools : []);
                  }}
                  title={mate.role}
                  className={`rounded-lg border px-2.5 py-1.5 text-caption font-semibold transition ${chosen === mate.slug ? "border-accent bg-accent/10 text-accent" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}
                >
                  {mate.name.replace(/ Agent$/, "")}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              A template fills in the wording and abilities. Your copy is independent — edit it freely.
            </p>
          </div>
        )}

        <Field label="Name" name="name" required maxLength={80} defaultValue={agent?.name ?? ""} placeholder="e.g. Alarm Triage" autoFocus />
        <Field label="Role" name="role" required maxLength={120} defaultValue={agent?.role ?? ""} placeholder="What this bot is responsible for" />
        <Field label="Short description" name="description" maxLength={300} defaultValue={agent?.description ?? ""} placeholder="One line shown under the name" />
        <Textarea label="Standing instructions" name="instructions" rows={5} maxLength={8000} defaultValue={agent?.instructions ?? ""} placeholder="How this bot should behave on every task" />

        <div>
          <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">Abilities ({tools.length} chosen)</span>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
            <div className="grid grid-cols-2 gap-1">
              {abilities.map(([id, label]) => (
                <label key={id} className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={tools.includes(id)}
                    onChange={(event) =>
                      setTools((current) => (event.target.checked ? [...current, id] : current.filter((tool) => tool !== id)))
                    }
                  />
                  <span className="truncate">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Anything irreversible still asks for approval, whoever holds it.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {mode === "edit" ? (
            <button type="button" onClick={() => void retire()} disabled={busy} className="text-caption font-semibold text-rose-600 hover:underline disabled:opacity-40">
              Retire this bot
            </button>
          ) : <span />}
          <span className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {mode === "create" ? "Create bot" : "Save"}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

export function BotWorkspace() {
  const router = useRouter();
  const toast = useToast();
  const [spaces, setSpaces] = useState<Array<{ id: string; label: string }>>([]);
  const [assistantId, setAssistantId] = useState("");
  const [assistantName, setAssistantName] = useState("Cyraops Assistant");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("New chat");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [model, setModel] = useState("deepseek-flash");
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([
    { id: "deepseek-flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  ]);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    toolName: string;
    summary: string;
    reason?: string;
    canAlwaysAllow?: boolean;
    answered?: "allow" | "deny";
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Null = the personal assistant. Otherwise the AI teammate being talked to. */
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [botModal, setBotModal] = useState<{ mode: "create" | "edit"; agent?: any; template?: string } | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [teammates, setTeammates] = useState<
    Array<{
      id?: string;
      slug: string;
      name: string;
      role: string;
      description: string;
      status?: string;
      isTemplate?: boolean;
      createdAt?: string | null;
      instructions?: string;
      tools?: string[];
    }>
  >([]);
  const [brief, setBrief] = useState<{
    user: { name: string | null; role: string };
    assistant: { name: string; model: string };
    pipeline: { deals: number; value: number; stalled: number };
    work: { overdue: number; dueToday: number; nextTask: string | null };
    leads: { goingCold: number };
    pages: Array<{ id: string; title: string }>;
    goals: Array<{ id: string; title: string; status: string; round: number; maxRounds: number }>;
    routines: Array<{ id: string; name: string; nextRunAt: string | null }>;
    isEmpty: boolean;
  } | null>(null);
  const [approvalMode, setApprovalMode] = useState<"ASK" | "AUTO" | "NEVER">("ASK");
  const [approvalRules, setApprovalRules] = useState<Array<{ toolName: string; effect: string }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const followingRef = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; mimeType: string; size: number; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [openPage, setOpenPage] = useState<OpenPage | null>(null);
  const [pagesBrowserOpen, setPagesBrowserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speakRepliesRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (meta && event.key.toLowerCase() === "i") {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadPages = useCallback(async (): Promise<PageMeta[]> => {
    try {
      const response = await fetch("/api/pages");
      const data = await response.json();
      const list: PageMeta[] = Array.isArray(data.pages) ? data.pages : [];
      setPages(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const showPage = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/pages/${id}`);
      const data = await response.json();
      if (data.page) {
        setOpenPage(data.page);
        setPagesBrowserOpen(false);
      }
    } catch {
      // the panel simply stays closed
    }
  }, []);

  const deleteConversation = async (id: string) => {
    setConversations((list) => list.filter((item) => item.id !== id));
    if (id === conversationId) {
      setConversationId("");
      setMessages([]);
      setConversationTitle("New chat");
      setPendingAction(null);
    }
    try {
      await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
    } catch {
      void loadConversations();
    }
  };

  const renameConversation = async (id: string, title: string) => {
    const next = title.trim().slice(0, 120);
    setRenamingId("");
    if (!next) return;
    setConversations((list) => list.map((item) => (item.id === id ? { ...item, title: next } : item)));
    try {
      await fetch(`/api/assistant/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
    } catch {
      void loadConversations();
    }
  };

  const pinConversation = async (id: string, pinned: boolean) => {
    setConversations((list) =>
      list.map((item) => (item.id === id ? { ...item, pinnedAt: pinned ? new Date().toISOString() : null } : item))
    );
    await fetch(`/api/assistant/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).catch(() => void loadConversations());
  };

  const archiveConversation = async (id: string, archived: boolean) => {
    setConversations((list) =>
      list.map((item) => (item.id === id ? { ...item, archivedAt: archived ? new Date().toISOString() : null } : item))
    );
    await fetch(`/api/assistant/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }).catch(() => void loadConversations());
  };

  useEffect(() => {
    // Switching teammate must re-scope the whole conversation list, not just
    // relabel the header.
    let alive = true;
    void (async () => {
      const url = activeAgent
        ? `/api/assistant/conversations?agent=${encodeURIComponent(activeAgent)}`
        : "/api/assistant/conversations";
      const data = await fetch(url).then((response) => response.json()).catch(() => ({}));
      if (!alive) return;
      const list = Array.isArray(data.conversations) ? data.conversations : [];
      setConversations(list);
      if (list[0]) await loadConversation(list[0].id);
      else {
        setConversationId("");
        setMessages([]);
        setConversationTitle(
          activeAgent ? teammates.find((mate) => mate.slug === activeAgent)?.name ?? "Teammate" : "New chat"
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent]);

  const loadTeammates = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/agents");
      const data = await response.json();
      const agents = Array.isArray(data.agents) ? data.agents : [];
      setTeammates(
        agents
          .filter((agent: any) => agent?.slug && agent.slug !== "chief_of_staff")
          // Templates keep their shipped order; your bots follow by creation, so
          // the newest sits directly above "New bot".
          .sort((a: any, b: any) => {
            if (Boolean(a.isTemplate) !== Boolean(b.isTemplate)) return a.isTemplate ? -1 : 1;
            if (a.isTemplate) return 0;
            return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
          })
          .map((agent: any) => ({
            id: agent.id as string,
            slug: agent.slug,
            name: agent.name,
            role: agent.role ?? "",
            description: agent.description ?? "",
            status: agent.status,
            isTemplate: Boolean(agent.isTemplate),
            createdAt: (agent.createdAt ?? null) as string | null,
            instructions: (agent.systemPrompt ?? "") as string,
            tools: (() => {
              try { return JSON.parse(agent.tools ?? "[]") as string[]; } catch { return []; }
            })(),
          }))
      );
    } catch {
      /* the roster is optional */
    }
  }, []);

  const loadBrief = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant/today");
      if (!response.ok) return;
      setBrief(await response.json());
    } catch {
      /* the brief is a convenience; the composer still works without it */
    }
  }, []);

  const loadApprovalSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant/me");
      const data = await response.json();
      if (data.assistant?.approvalMode) setApprovalMode(data.assistant.approvalMode);
      if (Array.isArray(data.approvalRules)) setApprovalRules(data.approvalRules);
    } catch {
      /* settings are optional */
    }
  }, []);

  const saveApprovalMode = async (mode: "ASK" | "AUTO" | "NEVER") => {
    setApprovalMode(mode);
    try {
      await fetch("/api/assistant/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalMode: mode }),
      });
    } catch {
      setError("Could not save the approval mode.");
    }
  };

  const removeRule = async (toolName: string) => {
    setApprovalRules((rules) => rules.filter((rule) => rule.toolName !== toolName));
    try {
      await fetch("/api/assistant/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeRuleFor: toolName }),
      });
    } catch {
      void loadApprovalSettings();
    }
  };

  const loadSpaces = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations");
      const data = await response.json();
      const groups = Array.isArray(data.conversations)
        ? data.conversations.filter((conversation: any) => conversation.type === "GROUP")
        : [];
      setSpaces(groups.map((conversation: any) => ({ id: conversation.id, label: conversation.label || "Group" })));
    } catch {
      // spaces list is best-effort
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const url = activeAgent
        ? `/api/assistant/conversations?agent=${encodeURIComponent(activeAgent)}`
        : "/api/assistant/conversations";
      const response = await fetch(url);
      const data = await response.json();
      if (Array.isArray(data.conversations)) setConversations(data.conversations);
    } catch {
      // list is best-effort
    }
  }, [activeAgent]);

  /** Switching teammate switches the whole thread, not just the label. */
  const selectAgent = useCallback(
    (slug: string | null) => {
      setActiveAgent(slug);
      // The row you left the page on is the row you come back to.
      try {
        window.localStorage.setItem(SELECTION_KEY, slug ?? "");
      } catch {
        /* storage may be unavailable */
      }
      setVoiceOpen(slug === null);
      setConversationId("");
      setMessages([]);
      setPendingAction(null);
      setConversationTitle(slug ? teammates.find((mate) => mate.slug === slug)?.name ?? "Teammate" : "New chat");
      // Resume this teammate's last thread: there is no list to pick it from.
      void (async () => {
        const url = slug ? `/api/assistant/conversations?agent=${encodeURIComponent(slug)}` : "/api/assistant/conversations";
        const data = await fetch(url).then((r) => r.json()).catch(() => ({}));
        const latest = Array.isArray(data.conversations) ? data.conversations[0] : null;
        if (latest?.id) await loadConversation(latest.id);
      })();
    },
    [teammates]
  );

  const loadConversation = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const [me, history] = await Promise.all([
          fetch("/api/assistant/me").then((r) => r.json()),
          fetch(`/api/assistant/messages?conversationId=${encodeURIComponent(id)}`).then((r) => r.json()),
        ]);
        setAssistantId(me.assistant?.id || history.assistantId || "");
        if (history.assistantName) setAssistantName(history.assistantName);
        if (me.assistant?.model) setModel(me.assistant.model);
        try {
          const modelResponse = await fetch("/api/assistant/models").then((r) => r.json());
          if (Array.isArray(modelResponse.models) && modelResponse.models.length > 0) {
            setModels(modelResponse.models.map((entry: any) => ({ id: entry.id, label: entry.label })));
          }
        } catch {
          // keep the built-in list
        }
        if (history.conversation) {
          setConversationId(history.conversation.id);
          setConversationTitle(history.conversation.title || "New chat");
        }
        setMessages(
          Array.isArray(history.messages)
            ? history.messages.map((message: any) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                toolCalls: message.toolCalls,
                attachments: message.attachments,
                createdAt: message.createdAt,
              }))
            : []
        );
      } catch {
        setError("Could not load your assistant.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * The bot page owns the viewport: its columns scroll, the document does not.
   * Locking the document here means no child can ever drag the page with it,
   * whatever the layout does later.
   */
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtml = html.style.overflow;
    const previousBody = body.style.overflow;
    const previousOverscroll = body.style.overscrollBehavior;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = previousHtml;
      body.style.overflow = previousBody;
      body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      await loadConversations();
      await loadSpaces();
      await loadApprovalSettings();
      await loadBrief();
      await loadTeammates();
      /**
       * Come back to whatever was last chosen: the assistant shows its voice
       * screen, a teammate or a bot shows that conversation.
       */
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(SELECTION_KEY);
      } catch {
        stored = null;
      }

      if (stored !== null && stored !== "") {
        // A bot was selected: open its chat, not the voice screen.
        setVoiceOpen(false);
        setActiveAgent(stored);
        const list = await fetch(`/api/assistant/conversations?agent=${encodeURIComponent(stored)}`)
          .then((r) => r.json())
          .catch(() => ({}));
        const latest = Array.isArray(list.conversations) ? list.conversations[0] : null;
        if (latest?.id) await loadConversation(latest.id);
        return;
      }

      // Assistant selected (or nothing remembered yet): its voice screen.
      setVoiceOpen(true);

      const list = await fetch("/api/assistant/conversations").then((r) => r.json()).catch(() => ({}));
      const first = list.conversations?.[0];
      if (first) {
        await loadConversation(first.id);
      } else {
        const history = await fetch("/api/assistant/messages").then((r) => r.json()).catch(() => ({}));
        await loadConversation(history.conversation?.id || "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  const atBottom = useCallback((el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80, []);

  const SLASH_COMMANDS = [
    { command: "/new", label: "Start a new chat", run: () => void newChat() },
    { command: "/pages", label: "Open pages", run: () => { void loadPages(); setPagesBrowserOpen(true); } },
    { command: "/browser", label: "Jump to the live browser", run: () => document.getElementById("rail-browser")?.scrollIntoView({ block: "nearest" }) },
    { command: "/routines", label: "Open routines", run: () => setRoutinesOpen(true) },
  ];
  const slashMatches = input.startsWith("/")
    ? SLASH_COMMANDS.filter((entry) => entry.command.startsWith(input.trim().split(" ")[0]))
    : [];
  const runSlash = (command: string) => {
    const entry = SLASH_COMMANDS.find((item) => item.command === command);
    setInput("");
    entry?.run();
  };

  // Grow with the text instead of asking the user to drag a resize handle.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  // A dropped stream or a closed tab must not lose what was typed.
  const draftKey = `cyraops:draft:${conversationId || "new"}`;
  useEffect(() => {
    if (!input) return;
    try {
      window.localStorage.setItem(draftKey, input);
    } catch {
      /* storage may be unavailable */
    }
  }, [input, draftKey]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setInput(saved);
    } catch {
      /* storage may be unavailable */
    }
    // Keyed on the conversation only: re-reading on every keystroke would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    // Only follow the tail while the reader is already at the bottom, so
    // scrolling up to read is never yanked back by an arriving token.
    const el = scrollRef.current;
    if (!el) return;
    if (followingRef.current) el.scrollTo({ top: el.scrollHeight });
    setAtEnd(atBottom(el));
  }, [messages, busy, atBottom]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const toggleListening = useCallback(async () => {
    if (listening) {
      stopListening();
      return;
    }

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError("This browser cannot do voice input. Chrome or Safari work best.");
      return;
    }

    /**
     * Ask for the microphone explicitly.
     *
     * SpeechRecognition fails silently when permission is denied: no error, no
     * result, just nothing. A getUserMedia call turns that into a sentence the
     * person can act on.
     */
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach((track) => track.stop());
    } catch (permissionError) {
      const name = (permissionError as DOMException)?.name ?? "";
      setError(
        name === "NotAllowedError"
          ? "Microphone is blocked. Allow it for this site in your browser settings, then try again."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one and try again."
            : "Could not reach the microphone. Check your system sound input settings."
      );
      return;
    }

    setError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language?.toLowerCase().startsWith("hi") ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) setInput(transcript);
    };

    // Every failure used to look identical: the mic simply stopped.
    recognition.onerror = (event: any) => {
      const reason = event?.error ?? "";
      setListening(false);
      const messages: Record<string, string> = {
        "not-allowed": "Microphone is blocked. Allow it for this site and try again.",
        "service-not-allowed": "The browser's speech service is turned off on this device.",
        "audio-capture": "No microphone was found. Connect one and try again.",
        "no-speech": "I didn't hear anything. Try again and speak a little closer.",
        network: "Voice needs an internet connection in Chrome, and it looks offline.",
        "language-not-supported": "This browser cannot transcribe that language.",
      };
      setError(messages[reason] ?? `Voice input stopped (${reason || "unknown reason"}).`);
    };

    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Could not start the microphone. Check browser permissions.");
    }
  }, [listening, stopListening]);

  const speak = useCallback((text: string) => {
    if (!speakRepliesRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
      const isHindi = /[\u0900-\u097F]/.test(text);
      utterance.lang = isHindi ? "hi-IN" : "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const preferred = isHindi
        ? voices.find((voice) => voice.lang?.toLowerCase().startsWith("hi"))
        : voices.find((voice) => voice.lang === "en-IN") || voices.find((voice) => /IN/.test(voice.lang || ""));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch {
      // speech synthesis is optional
    }
  }, []);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/assistant/upload", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        setAttachments((prev) => [...prev, data.attachment]);
      }
    } catch (err: any) {
      setError(err?.message || "Could not upload the file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const newChat = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeAgent ? { agentSlug: activeAgent } : {}),
      });
      const data = await response.json();
      if (data.conversation?.id) {
        await loadConversation(data.conversation.id);
        await loadConversations();
      }
    } catch {
      setError("Could not start a new chat.");
    }
  }, [loadConversation, loadConversations, activeAgent]);

  const selectConversation = useCallback(
    (id: string) => {
      void loadConversation(id);
    },
    [loadConversation]
  );

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;

    setInput("");
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* storage may be unavailable */
    }
    setBusy(true);
    setError(null);
    const sentAttachments = attachments;
    setAttachments([]);
    const pendingId = `pending_${Date.now()}`;
    const localClientId = `client_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `local_${Date.now()}`, clientId: localClientId, role: "user", content, createdAt: new Date().toISOString(), attachments: sentAttachments.length ? JSON.stringify(sentAttachments) : null },
      { id: pendingId, clientId: localClientId, role: "assistant", content: "", createdAt: new Date().toISOString(), streaming: true },
    ]);

    let replyText = "";
    let toolCallsUsed: string[] = [];
    const steps: ToolStep[] = [];
    const turnStartedAt = Date.now();
    const pushSteps = () =>
      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingId ? { ...message, toolCalls: JSON.stringify(steps) } : message
        )
      );
    let nextPending: { id: string; toolName: string; summary: string } | null = null;

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/assistant/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          assistantId: assistantId || undefined,
          conversationId: conversationId || undefined,
          content,
          agentSlug: activeAgent ?? undefined,
          attachmentIds: attachments.map((a) => a.id),
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The assistant failed to reply.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let payload: any;
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (payload.type === "token") {
            replyText += payload.content;
            setMessages((prev) => prev.map((message) => (message.id === pendingId ? { ...message, content: replyText } : message)));
          } else if (payload.type === "tool") {
            // Show the step the moment it starts, not after the turn ends.
            if (!toolCallsUsed.includes(payload.name)) toolCallsUsed.push(payload.name);
            const existing = steps.filter((step) => step.name === payload.name && step.status !== "running");
            const previousCount = existing.reduce((total, step) => total + step.count, 0);
            steps.push({ name: payload.name, status: "running", count: previousCount + 1 });
            pushSteps();
          } else if (payload.type === "tool_done") {
            const running = [...steps].reverse().find((step) => step.name === payload.name && step.status === "running");
            if (running) {
              running.status = payload.ok === false ? "failed" : "done";
              running.durationMs = payload.durationMs;
            }
            pushSteps();
          } else if (payload.type === "done") {
            if (payload.reply) replyText = payload.reply;
            toolCallsUsed = Array.isArray(payload.toolCallsUsed) ? payload.toolCallsUsed : [];
            if (payload.pendingAction) nextPending = payload.pendingAction;
            if (payload.conversationId) setConversationId(payload.conversationId);
          } else if (payload.type === "error") {
            throw new Error(payload.error || "The assistant failed to reply.");
          }
        }
      }

      for (const step of steps) if (step.status === "running") step.status = "done";
      const stepDuration = Date.now() - turnStartedAt;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingId
            ? {
                ...message,
                content: replyText || "_(stopped)_",
                toolCalls: JSON.stringify(steps.length ? steps : toolCallsUsed),
                streaming: false,
                toolDurationMs: stepDuration,
              }
            : message
        )
      );
      if (nextPending) setPendingAction(nextPending);
      speak(replyText);
      void loadConversations();
      // A page tool ran during this turn — surface the result immediately.
      if (toolCallsUsed.some((tool) => /browser|navigate|screenshot/i.test(tool))) {
        document.getElementById("rail-browser")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      if (toolCallsUsed.some((tool) => tool === "create_page" || tool === "update_page")) {
        const list = await loadPages();
        if (list[0]) await showPage(list[0].id);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Stopped on purpose: keep whatever arrived.
        setMessages((prev) =>
          prev.map((message) =>
            message.id === pendingId
              ? { ...message, content: replyText ? `${replyText}\n\n_(stopped)_` : "_(stopped)_", streaming: false }
              : message
          )
        );
      } else {
        // Nothing was persisted, so drop the optimistic pair too and hand the
        // text back instead of silently losing what the user typed.
        setMessages((prev) =>
          prev.filter((message) => message.id !== pendingId && message.clientId !== localClientId)
        );
        setInput((current) => current || content);
        setError(err?.message || "The assistant failed to reply.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const decide = async (approve: boolean, alwaysAllow = false) => {
    if (!pendingAction) return;
    const actionId = pendingAction.id;
    // The card stays where it is, marked as answered, so the transcript still
    // explains what happened instead of the decision vanishing.
    setPendingAction((current) => (current ? { ...current, answered: approve ? "allow" : "deny" } : current));
    try {
      const response = await fetch("/api/assistant/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, approve, alwaysAllow }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (approve && data.status && data.status !== "EXECUTED")) {
        // Revert the card so it stays actionable, and say what actually happened.
        setPendingAction((current) => (current ? { ...current, answered: undefined } : current));
        // The tool's own reason is the useful message: "mailbox is not configured" beats "failed to run".
        setError(
          data.error ||
            data.result?.error ||
            (data.status === "FAILED" ? `${data.toolName || "That action"} failed to run.` : "That action could not be completed.")
        );
        return;
      }
      const base = approve
        ? `✅ ${data.result?.data?.message || `${data.toolName ?? "Action"} completed.`}`
        : `↩️ Rejected: ${data.toolName ?? "action"}.`;
      const note = approve && alwaysAllow ? `${base} I won't ask about this again.` : base;
      setMessages((prev) => [...prev, { id: `sys_${Date.now()}`, role: "assistant", content: note }]);
      if (approve) void loadConversations();
    } catch {
      setPendingAction((current) => (current ? { ...current, answered: undefined } : current));
      setError("Could not process the action.");
    }
  };

  const changeModel = async (nextModel: string) => {
    setModel(nextModel);
    try {
      await fetch("/api/assistant/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: nextModel }),
      });
    } catch {
      // revert on failure is unnecessary; next load reflects server state
    }
  };

  const toolChips = (toolCalls: string | null | undefined): string[] => {
    if (!toolCalls) return [];
    try {
      const parsed = JSON.parse(toolCalls);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const formatTime = (iso?: string): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const dayLabel = (iso?: string): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(date, new Date())) return "Today";
    if (sameDay(date, new Date(Date.now() - 86_400_000))) return "Yesterday";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  /** Indian short scale, so a pipeline value reads at a glance. */
  const shortMoney = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return "₹0";
    if (value >= 1e7) return `₹${(value / 1e7).toFixed(1)} Cr`;
    if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
    if (value >= 1e3) return `₹${Math.round(value / 1e3)}k`;
    return `₹${Math.round(value)}`;
  };

  const copyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Untitled conversations are clutter — every real chat gets a title from its
  // first message, so hide the empty ones except the one being edited.
  const visibleConversations = conversations
    .filter((conversation) => conversation.title !== "New chat" || conversation.id === conversationId)
    .filter((conversation) => (showArchived ? Boolean((conversation as any).archivedAt) : !(conversation as any).archivedAt))
    .filter((conversation) =>
      searchQuery.trim() ? conversation.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) : true
    );

  // Prompts chosen from what is actually true, so the first screen is about
  // this business rather than a generic demo.
  return (
    <div className="relative grid overflow-hidden h-[calc(100dvh-62px-2rem)] w-full grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] sm:h-[calc(100dvh-62px-3.5rem)] xl:grid-cols-[240px_minmax(0,1fr)_260px]" /* main carries p-4 / p-7, so the page must subtract it or the whole grid overflows the viewport and the composer sits below the fold */>
      {/* Left rail — conversations */}
      <aside className="hidden min-h-0 flex-col border-r border-[var(--border)] md:flex">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
          <p className="text-caption font-bold uppercase tracking-widest text-[var(--muted)]">Cyraops Bot</p>
          <button
            onClick={() => void newChat()}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* The team: your assistant plus every AI teammate, each with its own thread */}
        <div className="border-b border-[var(--border)] px-2 py-2">
          <button
            onClick={() => {
              // The assistant, spoken to: this row opens the voice conversation.
              selectAgent(null);
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
              activeAgent === null ? "bg-accent/10" : "hover:bg-[var(--hover)]"
            }`}
          >
            <BotOrb size={24} />
            <span className="min-w-0">
              <span className="block truncate text-meta font-bold text-[var(--text)]">{assistantName}</span>
              <span className="flex items-center gap-1 truncate text-caption text-[var(--muted)]">
                <Mic size={9} /> Voice assistant · tap to talk
              </span>
            </span>
          </button>

          {teammates.length > 0 && (
            <>
              <button
                onClick={() => setTeamOpen((open) => !open)}
                aria-expanded={teamOpen}
                aria-controls="ai-teammates"
                className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-caption font-bold uppercase tracking-widest text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              >
                <ChevronDown size={11} className={`transition-transform ${teamOpen ? "" : "-rotate-90"}`} />
                <span className="flex-1">AI teammates</span>
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">
                  {teammates.length}
                </span>
              </button>
              <div id="ai-teammates" className={`mt-1 space-y-0.5 ${teamOpen ? "" : "hidden"}`}>
                {teammates.map((mate) => (
                  <span key={mate.slug} className="group/row relative flex items-center">
                  <button
                    onClick={() => selectAgent(mate.slug)}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                      activeAgent === mate.slug ? "bg-accent/10" : "hover:bg-[var(--hover)]"
                    }`}
                    title={mate.description}
                  >
                    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--muted)]">
                      <Users size={11} />
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
                          mate.status === "ACTIVE" ? "bg-emerald-500" : "bg-[var(--muted)]"
                        }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-meta font-medium text-[var(--text)]">{mate.name}</span>
                      <span className="block truncate text-[10px] text-[var(--muted)]">
                        {mate.role}
                        {mate.isTemplate && <span className="ml-1 rounded bg-[var(--surface-2)] px-1 text-[9px] font-semibold uppercase tracking-wide">template</span>}
                      </span>
                    </span>
                  </button>
                  {!mate.isTemplate && (
                    <button
                      onClick={(event) => { event.stopPropagation(); setBotModal({ mode: "edit", agent: mate }); }}
                      aria-label={`Edit ${mate.name}`}
                      title="Edit this bot"
                      className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted)] opacity-0 transition hover:bg-[var(--hover)] hover:text-accent focus:opacity-100 group-hover/row:opacity-100"
                    >
                      <Wrench size={10} />
                    </button>
                  )}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Always visible, and always under the last bot: creating one is not a
              thing you should have to expand a menu to find. */}
          <button
            onClick={() => setBotModal({ mode: "create" })}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-1.5 py-1.5 text-left text-[11px] font-semibold text-[var(--muted)] transition hover:border-accent/40 hover:text-accent"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-2)]">
              <Plus size={11} />
            </span>
            New bot
          </button>

          <button
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-controls="chat-history"
            className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-caption font-bold uppercase tracking-widest text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <ChevronDown size={11} className={`transition-transform ${historyOpen ? "" : "-rotate-90"}`} />
            <span className="flex-1">History</span>
            <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">
              {conversations.filter((conversation) => conversation.title && conversation.title !== "New chat").length}
            </span>
          </button>
          {historyOpen && (
            <div id="chat-history" className="soft-scrollbar mt-1 max-h-56 space-y-0.5 overflow-y-auto">
              {conversations.filter((conversation) => conversation.title && conversation.title !== "New chat").length === 0 ? (
                <p className="px-1.5 py-1 text-[11px] text-[var(--muted)]">Nothing yet — ask something.</p>
              ) : (
                conversations
                  .filter((conversation) => conversation.title && conversation.title !== "New chat")
                  .map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => {
                        setVoiceOpen(false);
                        selectConversation(conversation.id);
                      }}
                      title={conversation.title}
                      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                        conversation.id === conversationId ? "bg-accent/10 text-accent" : "hover:bg-[var(--hover)]"
                      }`}
                    >
                      <MessageSquare size={11} className="shrink-0 text-[var(--muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-[var(--text)]">{conversation.title}</span>
                        <span className="block truncate text-[10px] text-[var(--muted)]">
                          {new Date(conversation.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </span>
                      </span>
                    </button>
                  ))
              )}
            </div>
          )}
        </div>

        <div className="hidden">
          <span className="min-w-0">
            <span className="block truncate text-meta font-bold text-[var(--text)]">{assistantName}</span>
            <span className="block text-caption text-[var(--muted)]">Personal · remembers you</span>
          </span>
        </div>

        {/* The chat list is gone on purpose: one thread per teammate, resumed
            automatically, so there is nothing here to browse or tidy. */}

      </aside>

      {/* Centre — conversation */}
      <section className="flex min-h-0 flex-col overflow-hidden">
        {voiceOpen ? (
          <VoiceMode
            assistantId={assistantId || undefined}
            conversationId={conversationId || undefined}
            onConversation={(id) => setConversationId(id)}
            onExit={() => setVoiceOpen(false)}
          />
        ) : (
          <>
        <header className="flex h-[52px] items-center justify-between border-b border-[var(--border)] px-4">
          <div className="flex min-w-0 items-center gap-2">
            <BotOrb size={30} working={busy} halo={busy} />
            <span className="min-w-0">
              <b className="block truncate font-display text-[13px] font-extrabold tracking-tight text-[var(--text)]">
                {activeAgent
                  ? teammates.find((mate) => mate.slug === activeAgent)?.name ?? "Teammate"
                  : conversationTitle}
              </b>
              <span className="block truncate text-caption text-[var(--muted)]">
                {busy ? (
                  <span className="cy-shimmer-text font-semibold">Working…</span>
                ) : activeAgent ? (
                  <>
                    {teammates.find((mate) => mate.slug === activeAgent)?.role}
                    {" · on the team"}
                  </>
                ) : (
                  "Your assistant · remembers across chats · reads your CRM"
                )}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={conversationId}
              onChange={(event) => selectConversation(event.target.value)}
              className="mr-1 max-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-caption font-medium text-[var(--muted)] outline-none md:hidden"
              title="Switch chat"
            >
              {conversations.length === 0 ? (
                <option value="">New chat</option>
              ) : (
                conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
                ))
              )}
            </select>
            <button
              onClick={() => void newChat()}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] md:hidden"
              title="New chat"
              aria-label="New chat"
            >
              <Plus size={14} />
            </button>
            {/* The live browser toggles from the rail now, so the header does not
                need a second door to it. */}
            <button
              onClick={() => {
                void loadPages();
                setPagesBrowserOpen(true);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              title="Pages"
              aria-label="Pages"
            >
              <FileText size={14} />
            </button>
            <button
              onClick={() => setRoutinesOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              title="Routines"
              aria-label="Routines"
            >
              <Clock size={14} />
            </button>
            <select
              value={model}
              onChange={(e) => void changeModel(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-caption font-medium text-[var(--muted)] outline-none"
              title="Model"
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-caption font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> live
            </span>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            followingRef.current = atBottom(el);
            setAtEnd(atBottom(el));
          }}
          onWheel={(event) => {
            if (event.deltaY < 0) followingRef.current = false;
          }}
          onPointerDown={() => {
            followingRef.current = false;
          }}
          className="soft-scrollbar relative flex-1 overflow-y-auto px-5 py-4"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="cy-rise mx-auto flex h-full w-full max-w-[560px] flex-col justify-center gap-3">
              <BotOrb size={44} halo />
              <h2 className="font-display text-[24px] font-extrabold leading-tight tracking-tight text-[var(--text)]">
                {brief?.user?.name ? `Hello, ${brief.user.name}.` : "What are we working on?"}
              </h2>
              <p className="text-meta leading-relaxed text-[var(--text-2)]">
                {activeAgent
                  ? `I'm ${
                      teammates.find((mate) => mate.slug === activeAgent)?.name ?? "this bot"
                    } — ${teammates.find((mate) => mate.slug === activeAgent)?.role ?? "ready to work"}. Ask away.`
                  : "I'm your assistant, and I already know my way around your CRM — no need to explain the business twice."}
              </p>
              <p className="text-meta leading-relaxed text-[var(--muted)]">
                Tell me what you want in your own words: <em>&ldquo;what&rsquo;s due this week?&rdquo;</em>,{" "}
                <em>&ldquo;triage ticket #SR-7&rdquo;</em>, <em>&ldquo;find that invoice email&rdquo;</em>,{" "}
                <em>&ldquo;book a call Thursday at 3&rdquo;</em>, <em>&ldquo;send Adil the update&rdquo;</em>.
                Tickets, leads, mail, meetings, documents — I&rsquo;ll handle the boring parts and ask before I
                change anything.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {messages.map((message, index) => {
                const day = dayLabel(message.createdAt);
                const previousDay = index > 0 ? dayLabel(messages[index - 1].createdAt) : "";
                return (
                <div key={message.id}>
                {day && day !== previousDay && (
                  <div className="my-3 flex items-center gap-2" role="separator" aria-label={day}>
                    <span className="h-px flex-1 bg-[var(--border)]" />
                    <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-caption font-semibold uppercase tracking-wide text-[var(--faint)]">
                      {day}
                    </span>
                    <span className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                )}
                <div className={`cy-rise flex gap-2.5 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                  {message.role === "assistant" && <span className="mt-0.5"><BotOrb size={26} /></span>}
                  <div className={`min-w-0 ${message.role === "user" ? "max-w-[78%] text-right" : "max-w-[86%] flex-1"}`}>
                    <div
                      className={
                        message.role === "user"
                          ? "cy-bubble-user inline-block whitespace-pre-wrap break-words rounded-2xl rounded-tr-md px-3.5 py-2 text-prose leading-[1.55]"
                          : "break-words text-prose leading-[1.7] text-[var(--text)]"
                      }
                    >
                      {message.role === "assistant" && !message.content && busy ? (
                        <span role="status" aria-live="polite" className="flex items-center gap-1.5">
                          <span className="cy-shimmer-text text-meta font-semibold">Thinking…</span>
                        </span>
                      ) : (
                        toBlocks(message).map((block, index) => {
                          if (block.kind === "text") {
                            return <TextBlock key={index} block={block} assistant={message.role === "assistant"} />;
                          }
                          if (block.kind === "steps") return <StepBlock key={index} block={block} />;
                          if (block.kind === "files") return <FileBlock key={index} block={block} />;
                          return null;
                        })
                      )}
                      {message.streaming && message.content && (
                        <span className="cy-blink ml-0.5 inline-block h-3.5 w-[2px] rounded-full bg-accent align-middle" />
                      )}
                    </div>
                    {message.attachments && (() => {
                      try {
                        const items = JSON.parse(message.attachments);
                        if (!Array.isArray(items) || items.length === 0) return null;
                        return (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {items.map((item: any) => (
                              String(item.mimeType ?? "").startsWith("image/") ? (
                                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-[var(--border)]">
                                  <img src={item.url} alt={item.name} className="h-16 w-16 object-cover" />
                                </a>
                              ) : (
                                <a
                                  key={item.id}
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-caption text-[var(--muted)] hover:text-accent"
                                >
                                  <Paperclip size={10} /> {item.name}
                                </a>
                              )
                            ))}
                          </div>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                    {message.role === "assistant" && parseToolSteps(message.toolCalls).length > 0 && (
                      <ToolActivity
                        steps={parseToolSteps(message.toolCalls)}
                        live={Boolean(message.streaming) && busy}
                        durationMs={message.toolDurationMs}
                      />
                    )}
                    {message.role === "assistant" && message.content && (
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          onClick={() => void copyMessage(message.id, message.content)}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                          title="Copy reply"
                        >
                          {copiedId === message.id ? <Check size={11} /> : <Copy size={11} />}
                          {copiedId === message.id ? "Copied" : "Copy"}
                        </button>
                        {formatTime(message.createdAt) && (
                          <span className="text-caption text-[var(--muted)]">{formatTime(message.createdAt)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                </div>
                );
              })}
              {pendingAction && (
                <AskBlock
                  block={{
                    kind: "ask",
                    id: pendingAction.id,
                    summary: pendingAction.summary,
                    toolName: pendingAction.toolName,
                    answered: pendingAction.answered,
                    canAlwaysAllow: pendingAction.canAlwaysAllow,
                  }}
                  onDecide={(approve, alwaysAllow) => void decide(approve, alwaysAllow)}
                />
              )}
            </div>
          )}
        </div>



        {!atEnd && messages.length > 0 && (
          <button
            onClick={() => {
              followingRef.current = true;
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            }}
            aria-hidden={atEnd}
            tabIndex={atEnd ? -1 : 0}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-caption font-semibold text-[var(--text)] shadow-lg transition hover:border-accent"
          >
            Jump to latest
          </button>
        )}

        {error && (
          <div role="alert" className="border-t border-rose-500/20 bg-rose-500/10 px-4 py-2 text-meta text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="border-t border-[var(--border)] px-5 py-3">
          {attachments.length > 0 && (
            <div className="mx-auto mb-1.5 flex max-w-3xl flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span key={attachment.id} className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-caption text-[var(--muted)]">
                  <Paperclip size={10} /> {attachment.name}
                  <button onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))} className="ml-1 hover:text-rose-500">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {slashMatches.length > 0 && (
            <div className="mx-auto mb-1.5 max-w-3xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
              {slashMatches.map((entry) => (
                <button
                  key={entry.command}
                  onClick={() => runSlash(entry.command)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--hover)]"
                >
                  <span className="w-16 shrink-0 font-mono text-meta font-semibold text-accent">{entry.command}</span>
                  <span className="text-meta text-[var(--muted)]">{entry.label}</span>
                </button>
              ))}
            </div>
          )}
          <div
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                setDragging(true);
              }
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void uploadFiles(event.dataTransfer.files);
            }}
            className={`cy-focus-ring mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-[var(--surface)] p-1.5 shadow-[var(--shadow-1)] transition ${
              dragging ? "border-accent ring-2 ring-inset ring-accent/40" : "border-[var(--border-strong)]"
            }`}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  // Never send while an IME is still composing (Hindi input).
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  // A slash command is a command, not a message.
                  if (slashMatches.length > 0) {
                    e.preventDefault();
                    runSlash(slashMatches[0].command);
                    return;
                  }
                  e.preventDefault();
                  void send();
                }
                if (e.key === "Escape" && slashMatches.length) setInput("");
              }}
              onPaste={(event) => {
                // Only intercept real files; text pastes stay native.
                if (!event.clipboardData.files.length) return;
                event.preventDefault();
                void uploadFiles(event.clipboardData.files);
              }}
              placeholder={
                dragging
                  ? "Drop to attach…"
                  : `Message ${
                      activeAgent
                        ? teammates.find((mate) => mate.slug === activeAgent)?.name ?? "this bot"
                        : assistantName
                    }…`
              }
              rows={1}
              maxLength={5000}
              className="min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-prose outline-none placeholder:text-[var(--muted)]"
            />
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void uploadFiles(e.target.files)} accept=".txt,.csv,.md,.json,.pdf,.png,.jpg,.jpeg,.webp" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach a file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
            >
              {uploading ? <RefreshCw size={15} className="animate-spin" /> : <Paperclip size={15} />}
            </button>
            <button
              type="button"
              onClick={() => void toggleListening()}
              title={listening ? "Stop dictating" : "Dictate with your voice"}
              aria-label={listening ? "Stop dictating" : "Dictate with your voice"}
              aria-pressed={listening}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
                listening
                  ? "animate-pulse border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button
              type="button"
              onClick={() => {
                // Turning it on when the device cannot speak is worse than a
                // message: say so instead of staying silent.
                if (!speakReplies && (typeof window === "undefined" || !window.speechSynthesis)) {
                  setError("This browser cannot read replies aloud. Chrome, Safari and Edge can.");
                  return;
                }
                setError(null);
                setSpeakReplies((current) => {
                  const next = !current;
                  speakRepliesRef.current = next;
                  if (!next && typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
                  return next;
                });
              }}
              title={speakReplies ? "Stop speaking replies" : "Speak replies aloud"}
              aria-label={speakReplies ? "Stop speaking replies" : "Speak replies aloud"}
              aria-pressed={speakReplies}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition ${
                speakReplies ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              {speakReplies ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            {busy ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={(!input.trim() && attachments.length === 0) || uploading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[var(--shadow-accent)] transition duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
                aria-label="Send"
              >
                <CornerDownLeft size={15} />
              </button>
            )}
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl px-1 text-caption text-[var(--muted)]">
            {listening ? (
              <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
                Listening — speak now, it stops when you pause.
              </span>
            ) : (
              "Enter to send · Shift + Enter for a new line · / for commands · ⌘K to search · drop or paste a file to attach"
            )}
          </p>
        </div>
        </>
        )}
      </section>

      {/* Right rail — transparency */}
      <aside className="hidden h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] p-4 xl:flex">
        {/* "What it can see" was a frozen list that never matched the selected
            agent's tools, so it is gone rather than kept as decoration. */}
        <button
          onClick={() => setApprovalsOpen((open) => !open)}
          aria-expanded={approvalsOpen}
          aria-controls="approval-modes"
          className="mb-2 mt-6 flex w-full items-center gap-1.5 text-left text-caption font-bold uppercase tracking-widest text-[var(--muted)] transition hover:text-[var(--text)]"
        >
          <ChevronDown size={11} className={`transition-transform ${approvalsOpen ? "" : "-rotate-90"}`} />
          <Check size={12} />
          <span className="flex-1">Approvals</span>
          {/* The current mode stays readable while the section is folded. */}
          <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">
            {approvalMode === "ASK" ? "Ask me" : approvalMode === "AUTO" ? "Auto" : "Never ask"}
          </span>
        </button>
        <div id="approval-modes" className={`space-y-1 ${approvalsOpen ? "" : "hidden"}`}>
          {([
            ["ASK", "Ask me", "Every change waits for you"],
            ["AUTO", "Auto", "Reads run free; writes still ask"],
            ["NEVER", "Never ask", "Runs changes unattended (untrusted content still blocks)"],
          ] as const).map(([mode, label, hint]) => (
            <button
              key={mode}
              onClick={() => void saveApprovalMode(mode)}
              aria-pressed={approvalMode === mode}
              className={`block w-full rounded-lg border px-2 py-1.5 text-left transition ${
                approvalMode === mode
                  ? "border-accent bg-accent/10"
                  : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <span className="block text-meta font-semibold text-[var(--text)]">{label}</span>
              <span className="block text-caption leading-tight text-[var(--muted)]">{hint}</span>
            </button>
          ))}
        </div>
        {approvalsOpen && approvalRules.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-caption font-semibold text-[var(--muted)]">Always allowed</p>
            <div className="space-y-1">
              {approvalRules.map((rule) => (
                <div key={rule.toolName} className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-caption text-[var(--text)]">{rule.toolName}</span>
                  <button
                    onClick={() => void removeRule(rule.toolName)}
                    className="shrink-0 rounded p-0.5 text-[var(--muted)] transition hover:text-rose-600"
                    aria-label={`Stop always allowing ${rule.toolName}`}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {approvalsOpen && (
          <p className="mt-3 text-caption leading-relaxed text-[var(--muted)]">
            Reads run instantly. Writes ask first, and a run that read untrusted content always asks.
          </p>
        )}

        {/* Always visible: the assistant's browser is something you watch and
            occasionally drive, so it does not hide behind a toggle. */}
        <p className="mb-2 mt-4 flex items-center gap-1.5 text-caption font-bold uppercase tracking-widest text-[var(--muted)]">
          <Globe size={12} />
          <span className="flex-1">Live browser</span>
        </p>
        <div id="rail-browser" className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
          <BrowserPanel embedded />
        </div>
        <LocalBrowserAgent />
      </aside>

      <RoutinesModal open={routinesOpen} onClose={() => setRoutinesOpen(false)} />

      {openPage && (
        <PagesPanel
          key={openPage.id}
          page={openPage}
          onClose={() => setOpenPage(null)}
          onShared={(id, isPublic) => {
            setOpenPage((current) => (current && current.id === id ? { ...current, isPublic } : current));
            setPages((list) => list.map((entry) => (entry.id === id ? { ...entry, isPublic } : entry)));
          }}
        />
      )}


      {botModal && (
        <BotDialog
          mode={botModal.mode}
          agent={botModal.agent}
          template={botModal.template}
          teammates={teammates}
          onClose={() => setBotModal(null)}
          onSaved={(message) => {
            toast(message);
            setTeamOpen(true);
            void loadTeammates();
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        conversations={conversations.map((conversation) => ({ id: conversation.id, title: conversation.title }))}
        pages={pages.map((page) => ({ id: page.id, title: page.title }))}
        actions={[
          { id: "new", label: "New chat", hint: "start fresh", run: () => void newChat() },
          { id: "pages", label: "Open pages", run: () => { void loadPages(); setPagesBrowserOpen(true); } },
          { id: "browser", label: "Jump to live browser", run: () => document.getElementById("rail-browser")?.scrollIntoView({ block: "nearest" }) },
          { id: "routines", label: "Open routines", run: () => setRoutinesOpen(true) },
        ]}
        onOpenConversation={(id) => void selectConversation(id)}
        onOpenPage={(id) => void showPage(id)}
      />

      {pagesBrowserOpen && (
        <PagesBrowser
          pages={pages}
          onOpen={(id) => void showPage(id)}
          onClose={() => setPagesBrowserOpen(false)}
        />
      )}
    </div>
  );
}
