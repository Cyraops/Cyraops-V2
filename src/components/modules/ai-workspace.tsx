"use client";
/* eslint-disable react-hooks/purity */

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  Clock,
  Play,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Users,
  AlertTriangle,
  FileText,
  Activity,
  Sliders,
  Check,
  X,
  Pause,
  ChevronRight,
  ChevronDown,
  Layers,
  Wrench,
  Search,
  Monitor,
  Globe,
  ExternalLink,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Terminal,
  MousePointer,
  Download,
  Plus,
  Compass,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Crosshair,
  Key,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  Button,
  IconButton,
  Modal,
  EmptyState,
  Loading,
  useToast,
  Field,
  Textarea,
  Select,
} from "@/components/ui";

interface Agent {
  id: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  modelProfile: string;
  temperature: number;
  maxTokens: number;
  status: string;
  isMaster: boolean;
  version: string;
  tools: string;
}

interface AgentPresence {
  state: "Available" | "Working" | "Thinking" | "Waiting for approval" | "Waiting for user" | "Paused" | "Offline" | "Failed";
  currentTask?: {
    id: string;
    objective: string;
    activeStepTitle?: string;
    progressPercent: number;
  };
}

interface ProviderHealth {
  ok: boolean;
  message: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  agentId: string;
  title: string;
  updatedAt: string;
  agent?: Agent;
  messages?: Message[];
}

export function AiWorkspace({ initialTab }: { initialTab?: string }) {
  const toast = useToast();

  // 3-Panel State
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string>("chief_of_staff");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<"shared" | "personal">("shared");
  const [searchQuery, setSearchQuery] = useState("");

  // Data State
  const [agents, setAgents] = useState<Agent[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, AgentPresence>>({});
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTask, setActiveTask] = useState<any>(null);

  // Computer / Browser State
  const [computerState, setComputerState] = useState<any>({
    url: "https://example.com",
    title: "Agent Computer",
    screenshotUrl: null,
    status: "IDLE",
    history: [],
    isHumanTakeover: false,
  });
  const [manualUrl, setManualUrl] = useState("");
  const [computerLoading, setComputerLoading] = useState(false);

  // Synchronization refs for visibility & interval awareness
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const activeTaskRef = useRef<any>(activeTask);
  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);

  // Input & Sending State
  const [inputText, setInputText] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [isSending, setIsSending] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");

  // Modals
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [newAgentData, setNewAgentData] = useState({
    name: "",
    role: "",
    description: "",
    systemPrompt: "",
    modelProfile: "reasoning",
  });
  const [saveSkillModal, setSaveSkillModal] = useState<{ open: boolean; task?: any }>({ open: false });
  const [skillForm, setSkillForm] = useState({ name: "", description: "" });

  // Interactive Browser State
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number } | null>(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [typeForm, setTypeForm] = useState({ selector: "input", text: "" });
  const [extractedContent, setExtractedContent] = useState<string | null>(null);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [taskViewTab, setTaskViewTab] = useState<"plan" | "timeline" | "tools" | "results">("plan");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load Agents & Presence
  const loadAgents = async () => {
    try {
      const res = await fetch("/api/ai/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
        if (data.presence) setPresenceMap(data.presence);
        setProviderHealth(data.providerHealth || null);
      }
    } catch (e) {
      console.error("Failed to load agents", e);
    }
  };

  // Load Conversations
  const loadConversations = async (agentSlug?: string) => {
    try {
      const url = agentSlug ? `/api/ai/conversations?agentSlug=${agentSlug}` : "/api/ai/conversations";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const convs = data.conversations || [];
        setConversations(convs);

        // If no active conversation, pick the first or create one
        if (!activeConversationId && convs.length > 0) {
          setActiveConversationId(convs[0].id);
        } else if (convs.length === 0 && agentSlug) {
          // Auto create initial conversation for this agent
          createConversation(agentSlug, `Conversation with ${agentSlug}`);
        }
      }
    } catch (e) {
      console.error("Failed to load conversations", e);
    }
  };

  // Load Messages for Active Conversation
  const loadActiveConversationMessages = async (convId: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.conversation?.messages) {
          setMessages(data.conversation.messages);
        }
        if (data.activeTask) {
          setActiveTask(data.activeTask);
        }
      }
    } catch (e) {
      console.error("Failed to load conversation messages", e);
    }
  };

  // Load Computer / Browser State
  const loadComputerState = async () => {
    try {
      const res = await fetch("/api/ai/computer");
      if (res.ok) {
        const data = await res.json();
        if (data.state) setComputerState(data.state);
      }
    } catch (e) {
      console.error("Failed to load computer state", e);
    }
  };

  // Create Conversation
  const createConversation = async (agentSlug: string, title?: string) => {
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug, title: title || "New Operations Brief" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.conversation) {
          setConversations((prev) => [data.conversation, ...prev]);
          setActiveConversationId(data.conversation.id);
          setMessages(data.conversation.messages || []);
        }
      }
    } catch (e) {
      console.error("Failed to create conversation", e);
    }
  };

  // Initial Boot with Visibility-Aware Throttled Polling & Concurrency Guard
  useEffect(() => {
    loadAgents();
    loadConversations(selectedAgentSlug);
    loadComputerState();

    let inFlight = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      try {
        await Promise.all([
          loadAgents(),
          loadComputerState(),
          activeConversationIdRef.current
            ? loadActiveConversationMessages(activeConversationIdRef.current)
            : Promise.resolve(),
        ]);
      } catch (err) {
        // Silently catch to avoid infinite error loops
      } finally {
        inFlight = false;
      }
    };

    // When tab becomes visible again, trigger an immediate fresh poll
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void poll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    // Standard interval: 10s when idle, 4s when active task running
    const intervalTime = activeTaskRef.current ? 4000 : 10000;
    const interval = setInterval(poll, intervalTime);

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      clearInterval(interval);
    };
  }, [selectedAgentSlug]);

  // On Switch Conversation
  useEffect(() => {
    if (activeConversationId) {
      loadActiveConversationMessages(activeConversationId);
    }
  }, [activeConversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTask]);

  // Handle Switch Agent
  const handleSelectAgent = (slug: string) => {
    setSelectedAgentSlug(slug);
    // Find if a conversation already exists for this agent
    const existing = conversations.find((c) => c.agent?.slug === slug);
    if (existing) {
      setActiveConversationId(existing.id);
    } else {
      createConversation(slug, `Operations Brief with ${slug}`);
    }
  };

  // Send Instruction
  const handleSend = async (customText?: string) => {
    const text = (customText || inputText).trim();
    if (!text || isSending || !activeConversationId) return;

    setIsSending(true);
    setInputText("");

    // Optimistically add user message
    // eslint-disable-next-line react-hooks/purity
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/ai/conversations/${activeConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          priority: selectedPriority,
          delegateToSlug: selectedAgentSlug,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process instruction");

      if (data.assistantMessage) {
        setMessages((prev) => [...prev, data.assistantMessage]);
      }
      if (data.task) {
        setActiveTask(data.task);
      }
      await loadAgents();
      await loadComputerState();
    } catch (e: any) {
      toast(e.message || "Failed to send instruction", "error");
    } finally {
      setIsSending(false);
    }
  };

  // Emergency Stop Kill Switch
  const handleEmergencyStop = async () => {
    if (!confirm("EMERGENCY STOP: Halt all running agent tasks immediately?")) return;
    try {
      const res = await fetch("/api/ai/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "EMERGENCY_STOP", reason: "Kill switch triggered by user" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast(`Emergency Stop executed: ${data.pausedCount} tasks paused.`, "success");
      await loadAgents();
      if (activeConversationId) loadActiveConversationMessages(activeConversationId);
    } catch (e: any) {
      toast(e.message || "Emergency stop failed", "error");
    }
  };

  // Approval Decision
  const handleApproval = async (approvalId: string, action: "APPROVED" | "REJECTED") => {
    try {
      const res = await fetch("/api/ai/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action, reviewNotes: approvalNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast(`Action ${action.toLowerCase()} successfully`, "success");
      setApprovalNotes("");
      if (activeConversationId) loadActiveConversationMessages(activeConversationId);
      await loadAgents();
    } catch (e: any) {
      toast(e.message || "Approval decision failed", "error");
    }
  };

  // Browser Navigation from Right Panel
  const handleComputerNavigate = async (urlToNavigate?: string) => {
    const target = (urlToNavigate || manualUrl).trim();
    if (!target) return;
    setComputerLoading(true);
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "navigate", url: target }),
      });
      const data = await res.json();
      if (data.state) {
        setComputerState(data.state);
        setManualUrl("");
      }
    } catch (e: any) {
      toast(e.message || "Navigation failed", "error");
    } finally {
      setComputerLoading(false);
    }
  };

  // Human Takeover Toggle
  const handleTakeoverToggle = async () => {
    const nextState = !computerState.isHumanTakeover;
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "takeover", enabled: nextState }),
      });
      const data = await res.json();
      if (data.state) setComputerState(data.state);
      toast(nextState ? "Human Takeover Active" : "Control Released to Agent", "success");
    } catch (e) {
      toast("Failed to toggle takeover", "error");
    }
  };

  // Interactive Viewport Screenshot Click
  const handleScreenshotClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // Viewport mapped to standard 1280x800 desktop canvas
    const x = Math.round((relX / rect.width) * 1280);
    const y = Math.round((relY / rect.height) * 800);

    setClickRipple({ x: relX, y: relY });
    setTimeout(() => setClickRipple(null), 800);

    setComputerLoading(true);
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "click", x, y }),
      });
      const data = await res.json();
      if (data.state) setComputerState(data.state);
    } catch (err: any) {
      toast(err.message || "Click failed", "error");
    } finally {
      setComputerLoading(false);
    }
  };

  // Computer Actions: back, forward, refresh
  const handleComputerAction = async (action: "back" | "forward" | "refresh") => {
    setComputerLoading(true);
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.state) setComputerState(data.state);
    } catch (err: any) {
      toast(err.message || "Action failed", "error");
    } finally {
      setComputerLoading(false);
    }
  };

  // Computer Scroll
  const handleComputerScroll = async (direction: "up" | "down") => {
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scroll", direction, amount: 400 }),
      });
      const data = await res.json();
      if (data.state) setComputerState(data.state);
    } catch (err: any) {
      toast("Scroll failed", "error");
    }
  };

  // Computer Type
  const handleComputerType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeForm.text) return;
    setComputerLoading(true);
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "type",
          selector: typeForm.selector || "input",
          text: typeForm.text,
        }),
      });
      const data = await res.json();
      if (data.state) setComputerState(data.state);
      setShowTypeModal(false);
      setTypeForm({ selector: "input", text: "" });
      toast("Input sent to active page", "success");
    } catch (err: any) {
      toast(err.message || "Typing failed", "error");
    } finally {
      setComputerLoading(false);
    }
  };

  // Computer Extract Content
  const handleComputerExtract = async () => {
    setComputerLoading(true);
    try {
      const res = await fetch("/api/ai/computer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract" }),
      });
      const data = await res.json();
      if (data.data?.content) {
        setExtractedContent(data.data.content);
        setShowExtractModal(true);
      } else {
        toast("No readable content on page");
      }
    } catch (err: any) {
      toast(err.message || "Extraction failed", "error");
    } finally {
      setComputerLoading(false);
    }
  };

  // Create Custom Agent
  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentData.name || !newAgentData.role) {
      toast("Agent name and role are required", "error");
      return;
    }
    const slug = newAgentData.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    try {
      const res = await fetch("/api/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newAgentData, slug }),
      });
      if (res.ok) {
        toast(`Agent "${newAgentData.name}" created!`, "success");
        setCreateAgentOpen(false);
        setNewAgentData({ name: "", role: "", description: "", systemPrompt: "", modelProfile: "reasoning" });
        await loadAgents();
        handleSelectAgent(slug);
      }
    } catch (e) {
      toast("Failed to create agent", "error");
    }
  };

  // Save Task as Skill
  const handleSaveSkill = async () => {
    if (!skillForm.name.trim()) return;
    try {
      const slug = skillForm.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const res = await fetch("/api/ai/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_skill",
          name: skillForm.name,
          slug,
          description: skillForm.description || "Reusable workflow",
          instructions: saveSkillModal.task?.prompt || saveSkillModal.task?.objective || "",
        }),
      });
      if (res.ok) {
        toast(`Workflow saved as skill "${skillForm.name}"!`, "success");
        setSaveSkillModal({ open: false });
        setSkillForm({ name: "", description: "" });
      }
    } catch (e) {
      toast("Failed to save skill", "error");
    }
  };

  const selectedAgent = agents.find((a) => a.slug === selectedAgentSlug) || agents[0];
  const selectedAgentPresence = presenceMap[selectedAgentSlug] || { state: "Available" };

  const filteredAgents = agents.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = rosterFilter === "shared" ? a.isMaster || !a.slug.startsWith("custom_") : a.slug.startsWith("custom_");
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="-m-4 sm:-m-7 lg:-mx-9 lg:-my-4 flex h-[calc(100vh-62px)] overflow-hidden bg-[var(--surface-2)] text-[var(--text)]">
      {/* ========================================================= */}
      {/* 1. LEFT SIDEBAR: AGENT ROSTER & THREADS (280px)           */}
      {/* ========================================================= */}
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-sm">
        {/* Top Header */}
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
                <Users size={15} />
              </div>
              <h2 className="font-display text-sm font-extrabold tracking-tight">Cyraops Bot</h2>
            </div>
            <button
              onClick={() => setCreateAgentOpen(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[11px] font-bold text-accent hover:border-accent"
              title="Create new agent"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search roster..."
              aria-label="Search agent roster"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] pl-8 pr-3 text-xs outline-none focus:border-accent"
            />
          </div>

          {/* Filter Pills */}
          <div className="mt-3 flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-[11px] font-bold">
            <button
              onClick={() => setRosterFilter("shared")}
              className={`flex-1 rounded py-1 transition ${
                rosterFilter === "shared" ? "bg-[var(--surface)] text-accent shadow-xs" : "text-[var(--muted)]"
              }`}
            >
              Shared ({agents.filter((a) => a.isMaster || !a.slug.startsWith("custom_")).length})
            </button>
            <button
              onClick={() => setRosterFilter("personal")}
              className={`flex-1 rounded py-1 transition ${
                rosterFilter === "personal" ? "bg-[var(--surface)] text-accent shadow-xs" : "text-[var(--muted)]"
              }`}
            >
              Personal ({agents.filter((a) => a.slug.startsWith("custom_")).length})
            </button>
          </div>
        </div>

        {/* Agent Roster List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredAgents.map((agent) => {
            const isSelected = agent.slug === selectedAgentSlug;
            const presence = presenceMap[agent.slug] || { state: "Available" };
            const state = presence.state;

            // Presence color mapping
            const presenceColor =
              state === "Available"
                ? "bg-emerald-500"
                : state === "Working"
                ? "bg-purple-500 animate-pulse"
                : state === "Thinking"
                ? "bg-blue-500 animate-pulse"
                : state === "Waiting for approval"
                ? "bg-amber-500 animate-pulse"
                : state === "Waiting for user"
                ? "bg-indigo-500"
                : state === "Paused"
                ? "bg-gray-400"
                : state === "Offline"
                ? "bg-slate-400"
                : "bg-rose-500";

            return (
              <div
                key={agent.slug}
                onClick={() => handleSelectAgent(agent.slug)}
                className={`group flex flex-col rounded-xl p-2.5 transition cursor-pointer border ${
                  isSelected
                    ? "border-accent/30 bg-[#f4f2ff] dark:bg-[#2b2746]"
                    : "border-transparent hover:border-[var(--border)] hover:bg-[var(--hover)]"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="relative shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent/20 to-purple-500/20 font-bold text-accent shadow-xs">
                      {agent.isMaster ? <Compass size={18} /> : <Bot size={18} />}
                    </div>
                    {/* Live Presence Dot */}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface)] ${presenceColor}`}
                      title={`Presence: ${state}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs font-bold text-[var(--text)]">{agent.name}</span>
                      {agent.isMaster && (
                        <span className="rounded bg-accent/15 px-1 py-0.2 text-[9px] font-black uppercase text-accent">
                          Lead
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-[11px] text-[var(--muted)]">{agent.role}</span>
                  </div>
                </div>

                {/* Active Work Indicator */}
                {presence.currentTask && (
                  <div className="mt-2 rounded-lg bg-[var(--surface)] p-1.5 border border-[var(--border)] text-[10px]">
                    <div className="flex items-center justify-between text-[var(--muted)] font-medium mb-1">
                      <span className="truncate font-semibold text-accent flex items-center gap-1">
                        <Activity size={10} className="animate-spin" />
                        {presence.currentTask.activeStepTitle || state}
                      </span>
                      <span>{presence.currentTask.progressPercent}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${presence.currentTask.progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Status */}
        <div className="border-t border-[var(--border)] p-3 text-[11px] flex items-center justify-between text-[var(--muted)]">
          <div className="flex items-center gap-1.5 font-medium">
            <span
              className={`h-2 w-2 rounded-full ${
                providerHealth === null
                  ? "bg-slate-400 animate-pulse"
                  : providerHealth.ok
                  ? "bg-emerald-500"
                  : "bg-rose-500"
              }`}
            />
            <span title={providerHealth?.message || "Checking AI provider health"}>
              {providerHealth === null
                ? "Checking AI provider"
                : providerHealth.ok
                ? "OpenAI Responses API"
                : "OpenAI unavailable"}
            </span>
          </div>
          <span className="font-mono text-[10px]">v1.2.0</span>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* 2. CENTER PANEL: CONVERSATION & TASK CANVAS (flex-1)      */}
      {/* ========================================================= */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[var(--surface)]">
        {/* Center Panel Header */}
        <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-xs">
              {selectedAgent?.isMaster ? <Compass size={18} /> : <Bot size={18} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-display text-sm font-bold">{selectedAgent?.name}</h3>
                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  selectedAgentPresence.state === "Available"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : selectedAgentPresence.state === "Working" || selectedAgentPresence.state === "Thinking"
                    ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 animate-pulse"
                    : selectedAgentPresence.state === "Waiting for approval"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-gray-500/10 text-gray-500"
                }`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {selectedAgentPresence.state}
                </span>
              </div>
              <p className="truncate text-[11px] text-[var(--muted)]">{selectedAgent?.role}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model Badge */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
              <Sparkles size={12} className="text-accent" />
              <span>{selectedAgent?.modelProfile === "reasoning" ? "OpenAI o1 / Deep Reasoning" : "OpenAI Responses Engine"}</span>
            </div>

            {/* Emergency Stop Button */}
            <Button
              variant="danger"
              onClick={handleEmergencyStop}
              className="h-8 gap-1.5 text-xs font-bold shadow-xs"
            >
              <ShieldAlert size={14} />
              <span className="hidden sm:inline">Emergency Stop</span>
            </Button>

            {/* Toggle Computer Right Panel */}
            <IconButton
              label={rightPanelOpen ? "Collapse computer preview" : "Expand computer preview"}
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="border border-[var(--border)]"
            >
              {rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </IconButton>
          </div>
        </header>

        {/* Scrollable Conversation Stream */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center max-w-md mx-auto py-12">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent/20 to-purple-500/20 text-accent mb-4 shadow-sm">
                <Sparkles size={28} />
              </div>
              <h3 className="font-display text-base font-bold">Collaborate with {selectedAgent?.name}</h3>
              <p className="mt-1.5 text-xs text-[var(--muted)] leading-relaxed">
                Give an objective in plain natural language. Your agent plans the workflow, delegates subtasks across specialists, calls native CRM tools, and navigates web portals.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 max-w-3xl ${isUser ? "ml-auto justify-end" : "mr-auto justify-start"}`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-xs">
                      <Bot size={16} />
                    </div>
                  )}

                  <div className={`space-y-3 ${isUser ? "max-w-xl text-right" : "flex-1 text-left"}`}>
                    <div
                      className={`rounded-2xl p-4 text-xs leading-relaxed shadow-xs ${
                        isUser
                          ? "bg-accent text-white font-medium"
                          : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]"
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Active Task Execution & Transparency Center */}
          {activeTask && (
            <div className="rounded-2xl border border-accent/30 bg-[#f8f7ff] dark:bg-[#201d36] p-5 shadow-sm space-y-4 max-w-3xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-accent/20 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
                    <Activity size={14} className={activeTask.status === "RUNNING" ? "animate-spin" : ""} />
                  </div>
                  <div>
                    <h4 className="font-display text-xs font-bold text-accent">Active Mission Execution</h4>
                    <span className="text-[11px] text-[var(--muted)]">{activeTask.objective}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    activeTask.status === "COMPLETED"
                      ? "bg-emerald-500/15 text-emerald-600"
                      : activeTask.status === "AWAITING_APPROVAL"
                      ? "bg-amber-500/15 text-amber-600"
                      : activeTask.status === "RECOVERING"
                      ? "bg-blue-500/15 text-blue-600 animate-pulse"
                      : "bg-purple-500/15 text-purple-600 animate-pulse"
                  }`}>
                    {activeTask.status}
                  </span>
                  {activeTask.status === "COMPLETED" && (
                    <Button
                      variant="secondary"
                      onClick={() => setSaveSkillModal({ open: true, task: activeTask })}
                      className="h-7 text-[10px] font-bold gap-1"
                    >
                      <Layers size={11} /> Save as Skill
                    </Button>
                  )}
                </div>
              </div>

              {/* Durable Recovery Banner (Fix 3) */}
              {(activeTask.status === "RECOVERING" || activeTask.recoveryMetadata) && (
                <div className="flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <RotateCw size={14} className="animate-spin text-blue-600" />
                    <span className="font-semibold">
                      Task recovered after server restart. Resuming from step {activeTask.currentStepIndex || 1} of {activeTask.steps?.length || 1}.
                    </span>
                  </div>
                  <span className="rounded-md bg-blue-600/15 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-600">
                    Durable Recovery
                  </span>
                </div>
              )}

              {/* View Switcher Tabs */}
              <div className="flex items-center gap-1 border-b border-[var(--border)] pb-1 text-[11px]">
                <button
                  onClick={() => setTaskViewTab("plan")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    taskViewTab === "plan"
                      ? "bg-accent text-white"
                      : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  Execution Plan
                </button>
                <button
                  onClick={() => setTaskViewTab("timeline")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    taskViewTab === "timeline"
                      ? "bg-accent text-white"
                      : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  Live Timeline
                </button>
                <button
                  onClick={() => setTaskViewTab("tools")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition flex items-center gap-1 ${
                    taskViewTab === "tools"
                      ? "bg-accent text-white"
                      : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span>Tools</span>
                  <span className="rounded-full bg-accent/20 px-1.5 text-[9px]">
                    {activeTask.toolCalls?.length || 0}
                  </span>
                </button>
                {activeTask.status === "COMPLETED" && (
                  <button
                    onClick={() => setTaskViewTab("results")}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      taskViewTab === "results"
                        ? "bg-accent text-white"
                        : "text-emerald-600 font-bold hover:bg-emerald-500/10"
                    }`}
                  >
                    Results
                  </button>
                )}
              </div>

              {/* TAB 1: EXECUTION PLAN */}
              {taskViewTab === "plan" && activeTask.steps && activeTask.steps.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    <span>Task Plan & Specialist Delegation</span>
                    <span className="font-mono">
                      {activeTask.steps.filter((s: any) => s.status === "COMPLETED").length} of {activeTask.steps.length} completed
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {activeTask.steps.map((step: any) => (
                      <div
                        key={step.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs shadow-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            step.status === "COMPLETED"
                              ? "bg-emerald-500 text-white"
                              : step.status === "RUNNING"
                              ? "bg-purple-500 text-white animate-pulse"
                              : "bg-[var(--surface-2)] text-[var(--muted)]"
                          }`}>
                            {step.status === "COMPLETED" ? <Check size={10} /> : step.stepIndex}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold">{step.title}</span>
                              {step.assignedAgentSlug && (
                                <span className="rounded bg-accent/10 px-1.5 py-0.2 text-[9px] font-bold text-accent">
                                  @{step.assignedAgentSlug}
                                </span>
                              )}
                            </div>
                            {step.description && (
                              <p className="text-[10px] text-[var(--muted)] truncate">{step.description}</p>
                            )}
                          </div>
                        </div>

                        <span className={`text-[10px] font-bold uppercase shrink-0 ${
                          step.status === "COMPLETED" ? "text-emerald-600" : step.status === "RUNNING" ? "text-purple-600" : "text-[var(--muted)]"
                        }`}>
                          {step.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: LIVE ACTIVITY TIMELINE */}
              {taskViewTab === "timeline" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Chronological Execution Events
                  </span>
                  <div className="space-y-2.5 pl-2 border-l-2 border-accent/20">
                    <div className="text-[11px] flex items-start gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[var(--text)]">Task started</span>
                          <span className="text-[10px] text-[var(--muted)] font-mono">
                            {new Date(activeTask.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[10px] text-[var(--muted)]">{activeTask.objective}</p>
                      </div>
                    </div>

                    {activeTask.recoveryMetadata && (
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="h-2 w-2 rounded-full bg-blue-500 mt-1 shrink-0" />
                        <div>
                          <span className="font-semibold text-blue-600">Task recovered from durable database checkpoint</span>
                          <p className="text-[10px] text-[var(--muted)]">Resumed without duplicate execution of irreversible steps.</p>
                        </div>
                      </div>
                    )}

                    {activeTask.steps?.map((st: any) => (
                      <div key={st.id} className="text-[11px] flex items-start gap-2">
                        <span className={`h-2 w-2 rounded-full mt-1 shrink-0 ${
                          st.status === "COMPLETED" ? "bg-emerald-500" : st.status === "RUNNING" ? "bg-purple-500 animate-ping" : "bg-zinc-400"
                        }`} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[var(--text)]">
                              {st.assignedAgentSlug ? `@${st.assignedAgentSlug}: ` : ""}{st.title}
                            </span>
                            <span className={`text-[9px] font-bold uppercase ${
                              st.status === "COMPLETED" ? "text-emerald-600" : "text-[var(--muted)]"
                            }`}>{st.status}</span>
                          </div>
                          {st.description && <p className="text-[10px] text-[var(--muted)]">{st.description}</p>}
                        </div>
                      </div>
                    ))}

                    {activeTask.status === "COMPLETED" && (
                      <div className="text-[11px] flex items-start gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-600 mt-1 shrink-0" />
                        <div>
                          <span className="font-semibold text-emerald-600">Action completed and verified</span>
                          <span className="text-[10px] text-[var(--muted)] ml-2 font-mono">
                            {activeTask.completedAt ? new Date(activeTask.completedAt).toLocaleTimeString() : "Just now"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: TOOL EXECUTION VISIBILITY */}
              {taskViewTab === "tools" && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Tool Execution Visibility ({activeTask.toolCalls?.length || 0})
                  </span>
                  {(!activeTask.toolCalls || activeTask.toolCalls.length === 0) ? (
                    <p className="text-center py-4 text-xs text-[var(--muted)]">No tool invocations recorded yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {activeTask.toolCalls.map((tc: any) => {
                        let parsedInput = {};
                        let parsedOutput = {};
                        try { parsedInput = JSON.parse(tc.input || "{}"); } catch { parsedInput = tc.input; }
                        try { parsedOutput = JSON.parse(tc.output || "{}"); } catch { parsedOutput = tc.output; }

                        return (
                          <div key={tc.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[11px] space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 font-bold">
                                <Wrench size={12} className="text-accent" />
                                <span>{tc.toolName}</span>
                                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.2 font-mono text-[9px] text-[var(--muted)]">
                                  {tc.executionTimeMs}ms
                                </span>
                              </div>
                              <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                                tc.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                              }`}>
                                {tc.status}
                              </span>
                            </div>

                            {/* Safe summary of inputs (masked) */}
                            <div className="rounded bg-[var(--surface-2)] p-1.5 text-[10px] font-mono text-[var(--muted)] truncate">
                              <span className="text-[var(--text)] font-semibold">Input: </span>
                              {typeof parsedInput === "object" ? JSON.stringify(parsedInput) : String(parsedInput)}
                            </div>

                            {/* Safe summary of outputs (masked) */}
                            {tc.output && (
                              <div className="rounded bg-[var(--surface-2)] p-1.5 text-[10px] font-mono text-[var(--muted)] truncate">
                                <span className="text-[var(--text)] font-semibold">Output: </span>
                                {typeof parsedOutput === "object" ? JSON.stringify(parsedOutput) : String(parsedOutput)}
                              </div>
                            )}

                            {tc.error && (
                              <p className="text-[10px] text-rose-500 font-semibold">{tc.error}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: RESULTS CARD (FIX 1.D) */}
              {(taskViewTab === "results" || activeTask.status === "COMPLETED") && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                    <CheckCircle2 size={16} />
                    <span>Mission Accomplished & Verified</span>
                  </div>

                  {(() => {
                    let res: any = {};
                    try { res = JSON.parse(activeTask.result || "{}"); } catch { res = { summary: activeTask.result }; }

                    return (
                      <div className="space-y-2 text-xs text-[var(--text)]">
                        <p className="leading-relaxed font-medium">{res.summary || activeTask.objective}</p>

                        {/* Accomplished */}
                        {res.accomplished && res.accomplished.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Accomplishments</span>
                            <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-[var(--muted)]">
                              {res.accomplished.map((item: string, i: number) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Records Involved with links */}
                        {res.recordsInvolved && res.recordsInvolved.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Records Involved</span>
                            <div className="flex flex-wrap gap-1.5">
                              {res.recordsInvolved.map((rec: any, idx: number) => {
                                const targetHref =
                                  rec.href === "/companies" || rec.href === "/leads" || rec.href === "/deals"
                                    ? "/dashboard"
                                    : rec.href || "/dashboard";
                                return (
                                  <Link
                                    key={idx}
                                    href={targetHref}
                                    className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent hover:underline"
                                  >
                                    <ExternalLink size={10} />
                                    <span>{rec.name} ({rec.type})</span>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Changes & Incomplete items */}
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-[10px] text-[var(--muted)]">
                          <span>Changes: {res.changesApplied || "Audit logged & synced"}</span>
                          <span>{res.requiresFollowup ? "Follow-up required" : "Zero incomplete items"}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Pending Approvals Card (Class B/C) */}
              {activeTask.approvals?.filter((a: any) => a.status === "PENDING").map((appr: any) => (
                <div key={appr.id} className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-bold text-xs">
                    <AlertTriangle size={15} />
                    <span>Authorization Required (Class {appr.riskClass})</span>
                  </div>
                  <p className="text-xs text-[var(--text)]">{appr.description}</p>
                  <pre className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px] overflow-x-auto">
                    {appr.payload}
                  </pre>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="danger"
                      onClick={() => handleApproval(appr.id, "REJECTED")}
                      className="h-7 text-xs font-bold"
                    >
                      <X size={12} /> Reject
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleApproval(appr.id, "APPROVED")}
                      className="h-7 text-xs font-bold"
                    >
                      <Check size={12} /> Approve & Proceed
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Instruction Composer */}
        <div className="border-t border-[var(--border)] p-4 bg-[var(--surface)]">
          {/* Quick Prompts */}
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-[var(--muted)] shrink-0 font-bold uppercase text-[10px]">Shortcuts:</span>
            {[
              "Research top 5 enterprise accounts in healthcare",
              "Qualify inbound leads with BANT scoring",
              "Review deals open > 30 days and analyze risk",
              "Generate weekly executive pipeline health brief",
            ].map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(chip)}
                className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)] hover:border-accent hover:text-accent font-medium transition"
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10">
            <textarea
              rows={2}
              aria-label="Instruct AI agent"
              placeholder={`Instruct ${selectedAgent?.name || "your agent"} (e.g. "Research these companies and prepare an outreach draft")...`}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="w-full resize-none bg-transparent p-2 text-xs outline-none text-[var(--text)] placeholder:text-[var(--muted)]"
            />

            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 px-1">
              <div className="flex items-center gap-2">
                {/* Priority Selector */}
                <select
                  aria-label="Select execution priority"
                  value={selectedPriority}
                  onChange={(e: any) => setSelectedPriority(e.target.value)}
                  className="h-7 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-bold text-[var(--text)] outline-none"
                >
                  <option value="LOW">Priority: Low</option>
                  <option value="MEDIUM">Priority: Medium</option>
                  <option value="HIGH">Priority: High</option>
                  <option value="URGENT">Priority: Urgent</option>
                </select>

                <span className="hidden sm:inline text-[10px] text-[var(--muted)]">
                  Press <kbd className="rounded border px-1 bg-[var(--surface)]">Enter ↵</kbd> to execute
                </span>
              </div>

              <Button
                onClick={() => handleSend()}
                disabled={isSending || !inputText.trim()}
                className="h-7 px-3 text-xs font-bold gap-1 shadow-xs"
              >
                {isSending ? (
                  <>
                    <RotateCw size={12} className="animate-spin" />
                    <span>Orchestrating...</span>
                  </>
                ) : (
                  <>
                    <span>Execute</span>
                    <Send size={12} />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* ========================================================= */}
      {/* 3. RIGHT PANEL: AGENT COMPUTER / INTERACTIVE BROWSER (FIX 2) */}
      {/* ========================================================= */}
      {rightPanelOpen && (
        <aside className="flex w-[410px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-sm">
          {/* Header */}
          <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Monitor size={15} />
              </div>
              <div>
                <h4 className="font-display text-xs font-bold">Agent Computer</h4>
                <span className="text-[10px] text-[var(--muted)] font-mono">Isolated Chromium • Grok Mode</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Human Takeover Toggle */}
              <button
                onClick={handleTakeoverToggle}
                className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-bold uppercase transition ${
                  computerState.isHumanTakeover
                    ? "bg-amber-500 text-white shadow-xs"
                    : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
                title="Take direct manual control of the agent's browser"
              >
                <MousePointer size={11} />
                <span>{computerState.isHumanTakeover ? "Takeover On" : "Take Control"}</span>
              </button>

              <IconButton
                label="Collapse computer panel"
                onClick={() => setRightPanelOpen(false)}
              >
                <PanelRightClose size={15} />
              </IconButton>
            </div>
          </div>

          {/* Human Takeover Active Banner */}
          {computerState.isHumanTakeover && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={13} className="text-amber-600 animate-pulse" />
                <span>HUMAN IN CONTROL — AGENT PAUSED</span>
              </div>
              <button
                onClick={handleTakeoverToggle}
                className="rounded bg-amber-600 hover:bg-amber-700 text-white px-2 py-0.5 text-[10px] font-bold transition shadow-xs"
              >
                Return Control to Agent
              </button>
            </div>
          )}

          {/* Browser Navigation Toolbar */}
          <div className="border-b border-[var(--border)] p-3 bg-[var(--surface-2)] space-y-2">
            <div className="flex items-center gap-1.5">
              {/* Back / Forward / Refresh */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleComputerAction("back")}
                  disabled={computerLoading}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-accent disabled:opacity-50"
                  title="Back"
                  aria-label="Back"
                >
                  <ArrowLeft size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleComputerAction("forward")}
                  disabled={computerLoading}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-accent disabled:opacity-50"
                  title="Forward"
                  aria-label="Forward"
                >
                  <ArrowRight size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => handleComputerAction("refresh")}
                  disabled={computerLoading}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-accent disabled:opacity-50"
                  title="Reload"
                  aria-label="Reload"
                >
                  <RefreshCw size={12} className={computerLoading ? "animate-spin" : ""} />
                </button>
              </div>

              {/* URL Address Input */}
              <div className="flex-1 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 shadow-xs min-w-0">
                <Globe size={12} className="text-emerald-500 shrink-0" />
                <input
                  type="text"
                  placeholder="URL (e.g. news.ycombinator.com)..."
                  aria-label="Browser navigation address bar"
                  value={manualUrl || computerState.url}
                  onChange={(e) => setManualUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleComputerNavigate();
                  }}
                  className="flex-1 bg-transparent text-[11px] font-mono outline-none text-[var(--text)] truncate"
                />
                <button
                  onClick={() => handleComputerNavigate()}
                  disabled={computerLoading}
                  className="text-[10px] font-bold text-accent hover:underline shrink-0"
                >
                  {computerLoading ? <RotateCw size={11} className="animate-spin" /> : "Go"}
                </button>
              </div>
            </div>

            {/* Quick Interactive Controls */}
            <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[var(--border)]/50">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleComputerScroll("up")}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-bold hover:border-accent"
                  title="Scroll Page Up"
                >
                  <ArrowUp size={10} className="inline mr-0.5" /> Up
                </button>
                <button
                  onClick={() => handleComputerScroll("down")}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-bold hover:border-accent"
                  title="Scroll Page Down"
                >
                  <ArrowDown size={10} className="inline mr-0.5" /> Down
                </button>
                <button
                  onClick={() => setShowTypeModal(true)}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-bold hover:border-accent"
                  title="Type text into an input or selector"
                >
                  Type
                </button>
                <button
                  onClick={handleComputerExtract}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-bold hover:border-accent"
                  title="Extract visible text from page"
                >
                  Extract
                </button>
              </div>

              <span className={`font-bold uppercase font-mono text-[9px] ${
                computerState.status === "HUMAN_TAKEOVER"
                  ? "text-amber-600"
                  : computerState.status === "IDLE"
                  ? "text-emerald-600"
                  : "text-purple-600"
              }`}>
                {computerState.status}
              </span>
            </div>
          </div>

          {/* Interactive Viewport Screenshot */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                <span className="font-semibold flex items-center gap-1">
                  <Crosshair size={11} className="text-accent" />
                  <span>Interactive Viewport (Click to interact)</span>
                </span>
                <span className="truncate max-w-[160px] font-mono text-[9px]">
                  {computerState.title || "Ready"}
                </span>
              </div>

              <div className="relative rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden shadow-xs select-none">
                {computerState.screenshotUrl ? (
                  <div className="relative group cursor-crosshair">
                    <img
                      src={computerState.screenshotUrl}
                      alt="Agent Viewport"
                      onClick={handleScreenshotClick}
                      className="w-full object-cover rounded-t-xl transition duration-150 hover:brightness-[0.98]"
                    />

                    {/* Visual Click Ripple */}
                    {clickRipple && (
                      <span
                        className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/30 animate-ping"
                        style={{ left: `${clickRipple.x}px`, top: `${clickRipple.y}px` }}
                      />
                    )}

                    <a
                      href={computerState.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute top-2 right-2 rounded-lg bg-black/60 p-1.5 text-white backdrop-blur-xs opacity-0 group-hover:opacity-100 transition"
                      title="Open full resolution"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ) : (
                  <div className="flex h-52 flex-col items-center justify-center text-center p-4 text-[var(--muted)]">
                    <Monitor size={32} className="mb-2 opacity-50" />
                    <span className="text-xs font-semibold">Agent Browser Standby</span>
                    <span className="text-[10px] mt-1 max-w-[220px]">
                      Navigate to an external URL or let your agents execute browser tasks.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Browser Activity History Stream */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                <span>Computer Activity Log</span>
                <span className="font-mono text-[9px]">{computerState.history?.length || 0} events</span>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {computerState.history?.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)] text-center py-4">No computer events logged yet.</p>
                ) : (
                  computerState.history?.map((item: any) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[10px] space-y-0.5"
                    >
                      <div className="flex items-center justify-between font-bold">
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded px-1 py-0.2 text-[8px] font-mono ${
                            item.actor === "USER"
                              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                              : item.actor === "SYSTEM"
                              ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                              : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          }`}>
                            {item.actor || "AGENT"}
                          </span>
                          <span className="text-accent">{item.action}</span>
                        </div>
                        <span className="text-[var(--muted)] font-mono">{item.timestamp}</span>
                      </div>
                      {item.url && <p className="truncate text-[var(--muted)] font-mono">{item.url}</p>}
                      {item.details && <p className="text-[var(--text)] line-clamp-2">{item.details}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* CREATE AGENT MODAL */}
      {createAgentOpen && (
        <Modal
          open={createAgentOpen}
          onClose={() => setCreateAgentOpen(false)}
          title="Create New Specialist Agent"
        >
          <form onSubmit={handleCreateAgent} className="space-y-3 text-xs">
            <Field
              label="Agent Name"
              placeholder="e.g. Growth Hacker Agent"
              value={newAgentData.name}
              onChange={(e) => setNewAgentData({ ...newAgentData, name: e.target.value })}
            />
            <Field
              label="Role & Responsibilities"
              placeholder="e.g. B2B Outbound Outreach & Growth"
              value={newAgentData.role}
              onChange={(e) => setNewAgentData({ ...newAgentData, role: e.target.value })}
            />
            <Field
              label="Short Description"
              placeholder="Brief summary of agent scope..."
              value={newAgentData.description}
              onChange={(e) => setNewAgentData({ ...newAgentData, description: e.target.value })}
            />
            <Select
              label="Model Profile"
              value={newAgentData.modelProfile}
              onChange={(e) => setNewAgentData({ ...newAgentData, modelProfile: e.target.value })}
            >
              <option value="reasoning">OpenAI Deep Reasoning (o1 / gpt-4o)</option>
              <option value="fast">OpenAI Fast Analytical (gpt-4o-mini)</option>
            </Select>
            <Textarea
              label="System Instructions Prompt"
              rows={4}
              placeholder="Detailed instructions for the agent..."
              value={newAgentData.systemPrompt}
              onChange={(e) => setNewAgentData({ ...newAgentData, systemPrompt: e.target.value })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setCreateAgentOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Create Agent
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* SAVE SKILL MODAL */}
      {saveSkillModal.open && (
        <Modal
          open={saveSkillModal.open}
          onClose={() => setSaveSkillModal({ open: false })}
          title="Save Workflow as Reusable Skill"
        >
          <div className="space-y-3 text-xs">
            <p className="text-[var(--muted)]">
              Teach your agents this workflow so you or any teammate can execute it again anytime.
            </p>
            <Field
              label="Skill Name"
              placeholder="e.g. Weekly Deal Risk Review"
              value={skillForm.name}
              onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
            />
            <Field
              label="Description"
              placeholder="What does this skill accomplish?"
              value={skillForm.description}
              onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSaveSkillModal({ open: false })}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveSkill} disabled={!skillForm.name.trim()}>
                Save Skill
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* TYPE TEXT INTO BROWSER MODAL (FIX 2) */}
      {showTypeModal && (
        <Modal
          open={showTypeModal}
          onClose={() => setShowTypeModal(false)}
          title="Type Text into Active Browser Page"
        >
          <form onSubmit={handleComputerType} className="space-y-3 text-xs">
            <p className="text-[var(--muted)]">
              Enter text to type into an element selector (e.g. &apos;input[name=&quot;q&quot;]&apos;, &apos;textarea&apos;, &apos;#search&apos;).
            </p>
            <Field
              label="CSS Selector (optional, defaults to first input)"
              placeholder="e.g. input, textarea, #search"
              value={typeForm.selector}
              onChange={(e) => setTypeForm({ ...typeForm, selector: e.target.value })}
            />
            <Textarea
              label="Text to Type"
              rows={3}
              placeholder="Enter text or query..."
              value={typeForm.text}
              onChange={(e) => setTypeForm({ ...typeForm, text: e.target.value })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setShowTypeModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!typeForm.text.trim() || computerLoading}>
                {computerLoading ? <RotateCw size={12} className="animate-spin" /> : "Send Input"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* EXTRACTED CONTENT PREVIEW MODAL (FIX 2) */}
      {showExtractModal && (
        <Modal
          open={showExtractModal}
          onClose={() => setShowExtractModal(false)}
          title="Extracted Web Content"
        >
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span>URL: {computerState.url}</span>
              <span className="font-mono">{extractedContent?.length || 0} characters</span>
            </div>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[11px] leading-relaxed">
              {extractedContent || "No text found."}
            </pre>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="primary" onClick={() => setShowExtractModal(false)}>
                Close Preview
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
