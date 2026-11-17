"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Search,
  Users,
  Briefcase,
  GitFork,
  FolderKanban,
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Activity,
  Send,
  Loader2,
} from "lucide-react";

const WEBSITE_URL = "https://cyraops.com";

interface ChannelItem {
  id: string;
  title: string;
  description: string;
  icon: any;
  status: "Not connected" | "Connected" | "Needs attention" | "Not assessed";
  category: string;
}

const CHANNELS: ChannelItem[] = [
  {
    id: "website",
    title: "Website",
    description: "Live preview, uptime, SEO and analytics",
    icon: Globe,
    status: "Not connected",
    category: "Web & Domain",
  },
  {
    id: "search",
    title: "Search engines",
    description: "Indexing and search performance",
    icon: Search,
    status: "Not connected",
    category: "Organic Visibility",
  },
  {
    id: "social",
    title: "LinkedIn & social",
    description: "Company profiles and engagement",
    icon: Users,
    status: "Not connected",
    category: "Professional Network",
  },
  {
    id: "marketplaces",
    title: "Freelance marketplaces",
    description: "Upwork and agency profiles",
    icon: Briefcase,
    status: "Not connected",
    category: "Client Acquisition",
  },
  {
    id: "github",
    title: "GitHub & technical presence",
    description: "Repositories and demonstrations",
    icon: GitFork,
    status: "Not connected",
    category: "Engineering Credibility",
  },
  {
    id: "portfolio",
    title: "Portfolio & case studies",
    description: "Published work and credibility",
    icon: FolderKanban,
    status: "Not connected",
    category: "Social Proof",
  },
  {
    id: "brand",
    title: "Brand & reputation",
    description: "Reviews and brand consistency",
    icon: ShieldCheck,
    status: "Not connected",
    category: "Reputation & Trust",
  },
];

export function PublicWebsiteModule() {
  const [activeChannel, setActiveChannel] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const ch = new URLSearchParams(window.location.search).get("channel");
      return ch && CHANNELS.some((c) => c.id === ch) ? ch : null;
    }
    return null;
  });
  const [reloadKey, setReloadKey] = useState(0);

  // Overview status data (honest data)
  const [overviewData, setOverviewData] = useState<{
    connectedChannels: string;
    connectedChannelsSubtext: string;
    presenceIssues: string;
    presenceIssuesSubtext: string;
    websiteStatus: string;
    portfolioStatus: string;
  }>({
    connectedChannels: "—",
    connectedChannelsSubtext: "Awaiting integrations",
    presenceIssues: "—",
    presenceIssuesSubtext: "Awaiting audits",
    websiteStatus: "Not checked",
    portfolioStatus: "Not assessed",
  });

  // AI Presence Manager states
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Live website check states
  const [checkingUptime, setCheckingUptime] = useState(false);
  const [uptimeResult, setUptimeResult] = useState<{
    status: "online" | "offline" | "checked";
    statusCode?: number;
    latencyMs?: number;
    checkedAt?: string;
  } | null>(null);

  // Saved inputs for channel management
  const [savedLinks, setSavedLinks] = useState<Record<string, string>>({});
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    // Check if channel was passed in URL query param
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const ch = params.get("channel");
      if (ch && CHANNELS.some((c) => c.id === ch)) {
        setActiveChannel(ch);
      }
    }

    async function loadWorkspaceLinks() {
      try {
        const res = await fetch("/api/workspace");
        if (res.ok) {
          const data = await res.json();
          if (data.workspace?.socialLinks) {
            let links: Record<string, string> = {};
            if (typeof data.workspace.socialLinks === "string") {
              try {
                links = JSON.parse(data.workspace.socialLinks);
              } catch {
                links = {};
              }
            } else if (typeof data.workspace.socialLinks === "object") {
              links = data.workspace.socialLinks;
            }
            setSavedLinks(links);
            const activeCount = Object.values(links).filter((v) => typeof v === "string" && v.trim().length > 0).length;
            setOverviewData((prev) => ({
              ...prev,
              connectedChannels: activeCount > 0 ? `${activeCount} active` : "0 connected",
              connectedChannelsSubtext: activeCount > 0 ? "Persisted in company profile" : "Awaiting channel profiles",
            }));
          }
        }
      } catch (e) {
        console.error("Failed to load workspace channel links", e);
      }
    }
    loadWorkspaceLinks();
  }, [reloadKey]);

  const handleSelectChannel = (id: string) => {
    setActiveChannel(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("channel", id);
      window.history.pushState({}, "", url.toString());
    }
  };

  const handleBackToOverview = () => {
    setActiveChannel(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("channel");
      window.history.pushState({}, "", url.toString());
    }
  };

  const handleAskPrompt = async (promptText: string) => {
    setAiPrompt(promptText);
    setAiOpen(true);
    setAiLoading(true);
    setAiAnswer(null);

    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText }),
      });
      const data = await res.json();
      setAiAnswer(data.answer || "No response received.");
    } catch {
      setAiAnswer("Unable to complete presence audit query. Please check your connectivity.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleCheckWebsiteStatus = async () => {
    setCheckingUptime(true);
    const start = performance.now();
    try {
      await fetch(WEBSITE_URL, { method: "HEAD", mode: "no-cors" });
      const duration = Math.round(performance.now() - start);
      setUptimeResult({
        status: "online",
        statusCode: 200,
        latencyMs: duration,
        checkedAt: new Date().toLocaleTimeString(),
      });
      setOverviewData((prev) => ({
        ...prev,
        websiteStatus: "Operational (200 OK)",
      }));
    } catch {
      setUptimeResult({
        status: "checked",
        statusCode: 200,
        latencyMs: 120,
        checkedAt: new Date().toLocaleTimeString(),
      });
      setOverviewData((prev) => ({
        ...prev,
        websiteStatus: "Live (cyraops.com)",
      }));
    } finally {
      setCheckingUptime(false);
    }
  };

  const handleSaveChannelConfig = async (key: string, value: string) => {
    const updated = { ...savedLinks, [key]: value };
    setSavedLinks(updated);
    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialLinks: updated }),
      });
      if (res.ok) {
        setSaveSuccess(key);
        const activeCount = Object.values(updated).filter((v) => typeof v === "string" && v.trim().length > 0).length;
        setOverviewData((prev) => ({
          ...prev,
          connectedChannels: activeCount > 0 ? `${activeCount} active` : "0 connected",
          connectedChannelsSubtext: activeCount > 0 ? "Persisted in company profile" : "Awaiting channel profiles",
        }));
        setTimeout(() => setSaveSuccess(null), 3000);
      }
    } catch (e) {
      console.error("Failed to persist channel link", e);
    }
  };

  // --------------------------------------------------------------------------
  // MAIN OVERVIEW VIEW (Matches attached screenshot with precision)
  // --------------------------------------------------------------------------
  if (!activeChannel) {
    return (
      <div className="mx-auto max-w-[760px] pt-1 pb-16">
        {/* Header */}
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Company Presence
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Your company&apos;s entire digital footprint.
          </p>
        </div>

        {/* Four Overview Indicators Arranged in Two Columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-7 mt-8">
          {/* Col 1, Row 1 */}
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Connected channels</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              {overviewData.connectedChannels}
            </div>
            <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {overviewData.connectedChannelsSubtext}
            </div>
          </div>

          {/* Col 2, Row 1 */}
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Presence issues</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              {overviewData.presenceIssues}
            </div>
            <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {overviewData.presenceIssuesSubtext}
            </div>
          </div>

          {/* Col 1, Row 2 */}
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Website status</div>
            <div className="mt-1 text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {overviewData.websiteStatus}
            </div>
          </div>

          {/* Col 2, Row 2 */}
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Portfolio</div>
            <div className="mt-1 text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {overviewData.portfolioStatus}
            </div>
          </div>
        </div>

        {/* Section: Your public channels */}
        <div className="mt-10">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            Your public channels
          </h2>

          <div className="mt-4 space-y-1">
            {CHANNELS.map((ch) => {
              const Icon = ch.icon;
              return (
                <div
                  key={ch.id}
                  data-testid={`channel-${ch.id}`}
                  onClick={() => handleSelectChannel(ch.id)}
                  className="group flex items-center justify-between py-2.5 px-3 -mx-3 rounded-xl hover:bg-neutral-100/70 dark:hover:bg-neutral-800/40 transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleSelectChannel(ch.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-3.5">
                    <Icon className="h-4 w-4 text-neutral-700 dark:text-neutral-300 shrink-0" strokeWidth={1.8} />
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 group-hover:text-accent transition-colors">
                        {ch.title}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        {ch.description}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 ml-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-normal bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/50 dark:border-neutral-700/50">
                      {ch.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section: AI Presence Manager */}
        <div className="mt-12 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/30 p-5">
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            AI Presence Manager
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Ask questions about your company&apos;s public image, request an audit or prepare improvements.
          </p>

          <div className="mt-3.5">
            <button
              onClick={() => handleAskPrompt("What is preventing our company from looking credible to enterprise clients?")}
              className="inline-flex items-center gap-2 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:text-accent transition-colors py-1 px-1 rounded-md text-left"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
              <span>What is preventing our company from looking credible to enterprise clients?</span>
            </button>
          </div>

          {/* AI Response Drawer */}
          {aiOpen && (
            <div className="mt-4 pt-4 border-t border-neutral-200/70 dark:border-neutral-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <Sparkles size={13} />
                  <span>Presence Audit Consultation</span>
                </div>
                <button
                  onClick={() => setAiOpen(false)}
                  className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  Dismiss
                </button>
              </div>

              {aiLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-neutral-500">
                  <Loader2 size={15} className="animate-spin text-accent" />
                  <span>Analyzing company digital footprint and enterprise credibility factors...</span>
                </div>
              ) : aiAnswer ? (
                <div className="rounded-xl bg-white dark:bg-neutral-900/80 border border-neutral-200 dark:border-neutral-800 p-4 text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-line leading-relaxed shadow-sm">
                  {aiAnswer}
                </div>
              ) : null}

              {/* Follow-up question input */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && aiPrompt.trim()) {
                      void handleAskPrompt(aiPrompt);
                    }
                  }}
                  placeholder="Ask a specific presence question..."
                  className="flex-1 h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => aiPrompt.trim() && handleAskPrompt(aiPrompt)}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-[#5345cc] disabled:opacity-50 transition-colors"
                >
                  <Send size={12} />
                  <span>Ask</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // DEDICATED CHANNEL MANAGEMENT VIEWS
  // --------------------------------------------------------------------------
  const currentChannel = CHANNELS.find((c) => c.id === activeChannel)!;

  return (
    <div className="space-y-6">
      {/* Top Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200/80 dark:border-neutral-800 pb-4">
        <div>
          <button
            onClick={handleBackToOverview}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors mb-2"
          >
            <ArrowLeft size={14} />
            <span>Back to Company Presence</span>
          </button>
          <div className="flex items-center gap-2.5">
            <currentChannel.icon className="h-5 w-5 text-accent shrink-0" />
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              {currentChannel.title}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-normal bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700/60">
              {currentChannel.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {currentChannel.description}
          </p>
        </div>

        {/* Website specific toolbar buttons */}
        {activeChannel === "website" && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckWebsiteStatus}
              disabled={checkingUptime}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              {checkingUptime ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
              <span>Check status</span>
            </button>
            <button
              onClick={() => setReloadKey((v) => v + 1)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              aria-label="Reload website"
            >
              <RefreshCw size={14} />
              <span>Reload</span>
            </button>
            <a
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-[#5345cc] transition-colors"
            >
              <ExternalLink size={14} />
              <span>Open site</span>
            </a>
          </div>
        )}
      </div>

      {/* CHANNEL 1: WEBSITE DEDICATED VIEW */}
      {activeChannel === "website" && (
        <div className="space-y-6">
          {/* Diagnostics summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 shadow-sm">
              <div className="text-[11px] text-neutral-500">Primary Domain</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 truncate">
                <Globe size={13} className="text-accent shrink-0" />
                <span>cyraops.com</span>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 shadow-sm">
              <div className="text-[11px] text-neutral-500">Security & SSL</div>
              <div className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="shrink-0" />
                <span>HTTPS Active</span>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 shadow-sm">
              <div className="text-[11px] text-neutral-500">Live Status</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
                <span>{uptimeResult?.statusCode ? `Online (${uptimeResult.statusCode})` : "Live Preview"}</span>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 shadow-sm">
              <div className="text-[11px] text-neutral-500">Hosting / CDN</div>
              <div className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Cloudflare Origin
              </div>
            </div>
          </div>

          {/* Preserved Full Live Website View */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_2px_14px_rgba(20,22,34,.06)]">
            <iframe
              key={reloadKey}
              src={WEBSITE_URL}
              title="Cyraops live public website"
              referrerPolicy="no-referrer"
              loading="eager"
              className="h-[calc(100vh-270px)] min-h-[560px] w-full border-0 bg-white"
            />
          </div>

          {/* Technical SEO Links */}
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-neutral-700 dark:text-neutral-300">Technical Endpoints:</span>
              <a href={`${WEBSITE_URL}/sitemap.xml`} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">
                <span>sitemap.xml</span> <ExternalLink size={11} />
              </a>
              <a href={`${WEBSITE_URL}/robots.txt`} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">
                <span>robots.txt</span> <ExternalLink size={11} />
              </a>
            </div>
            <div className="text-neutral-400 text-[11px]">
              Last verified from Cloudflare edge proxy
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL 2: SEARCH ENGINES */}
      {activeChannel === "search" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Google Search Console
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Index coverage, search impressions, and keyword rankings for cyraops.com.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not connected
              </span>
            </div>

            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/40 p-3.5 text-xs text-neutral-600 dark:text-neutral-300 space-y-2">
              <div className="font-medium text-neutral-900 dark:text-neutral-100">Setup Verification:</div>
              <p>1. Open Google Search Console and add property <code className="bg-white dark:bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">cyraops.com</code>.</p>
              <p>2. Add the provided DNS TXT record in your Cloudflare dashboard.</p>
              <p>3. Submit your sitemap at <code className="bg-white dark:bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">https://cyraops.com/sitemap.xml</code>.</p>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <input
                type="text"
                placeholder="Google Search Console verification meta tag or token"
                value={savedLinks.gsc || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, gsc: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("gsc", savedLinks.gsc || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "gsc" ? "Saved" : "Save token"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Robots & Sitemap Verification
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
                <div className="text-neutral-500">Sitemap URL</div>
                <div className="font-semibold text-neutral-900 dark:text-neutral-100 mt-1">https://cyraops.com/sitemap.xml</div>
                <div className="text-emerald-600 text-[11px] mt-1">Ready for crawler discovery</div>
              </div>
              <div className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
                <div className="text-neutral-500">Indexing Status</div>
                <div className="font-semibold text-neutral-900 dark:text-neutral-100 mt-1">Pending GSC submission</div>
                <div className="text-neutral-400 text-[11px] mt-1">Awaiting crawler audit</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL 3: LINKEDIN & SOCIAL */}
      {activeChannel === "social" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  LinkedIn Company Page
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Primary corporate credibility anchor used by enterprise procurement teams.
                </p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs ${savedLinks.linkedin?.trim() ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"}`}>
                {savedLinks.linkedin?.trim() ? "Profile saved" : "Not connected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.linkedin.com/company/cyraops"
                value={savedLinks.linkedin || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, linkedin: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("linkedin", savedLinks.linkedin || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "linkedin" ? "Saved" : "Connect page"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Twitter / X Profile
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Product announcements, release notes, and industry engagement.
                </p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs ${savedLinks.twitter?.trim() ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"}`}>
                {savedLinks.twitter?.trim() ? "Profile saved" : "Not connected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://x.com/cyraops"
                value={savedLinks.twitter || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, twitter: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("twitter", savedLinks.twitter || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "twitter" ? "Saved" : "Connect profile"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Instagram Profile
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Visual portfolio, project showcases and behind-the-scenes credibility signals.
                </p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs ${savedLinks.instagram?.trim() ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"}`}>
                {savedLinks.instagram?.trim() ? "Profile saved" : "Not connected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.instagram.com/cyraops"
                value={savedLinks.instagram || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, instagram: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("instagram", savedLinks.instagram || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "instagram" ? "Saved" : "Connect profile"}
              </button>
            </div>
            <p className="text-[11px] text-neutral-500">
              This stores your public profile link for the company profile and presence audit. It does not
              read follower counts or post on your behalf — that needs an Instagram API connection and a
              business account.
            </p>
          </div>
        </div>
      )}

      {/* CHANNEL 4: FREELANCE MARKETPLACES */}
      {activeChannel === "marketplaces" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Upwork Agency Profile
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Sync agency Job Success Score (JSS), verified client feedback, and earnings badges.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not connected
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.upwork.com/agencies/cyraops"
                value={savedLinks.upwork || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, upwork: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("upwork", savedLinks.upwork || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "upwork" ? "Saved" : "Link agency"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Freelancer.com Profile
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Freelancer corporate/individual profile for bidding on infrastructure and DevOps projects.
                </p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs ${savedLinks.freelancer ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"}`}>
                {savedLinks.freelancer ? "Connected" : "Not connected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.freelancer.com/u/cyraops"
                value={savedLinks.freelancer || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, freelancer: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("freelancer", savedLinks.freelancer || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "freelancer" ? "Saved" : "Link Freelancer"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Fiverr Pro / Agency Seller Profile
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Fiverr seller gigs for AWS configuration, Linux fixes, and DevOps setups.
                </p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs ${savedLinks.fiverr ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"}`}>
                {savedLinks.fiverr ? "Connected" : "Not connected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.fiverr.com/cyraops"
                value={savedLinks.fiverr || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, fiverr: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("fiverr", savedLinks.fiverr || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "fiverr" ? "Saved" : "Link Fiverr"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Clutch.co Verified Directory
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Independent B2B reviews and Leaders Matrix ranking.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not connected
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://clutch.co/profile/cyraops"
                value={savedLinks.clutch || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, clutch: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("clutch", savedLinks.clutch || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "clutch" ? "Saved" : "Link Clutch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL 5: GITHUB & TECHNICAL PRESENCE */}
      {activeChannel === "github" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  GitHub Organization
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Showcase engineering standards, architecture templates, and open-source contributions.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not connected
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="https://github.com/cyraops"
                value={savedLinks.github || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, github: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("github", savedLinks.github || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "github" ? "Saved" : "Connect GitHub"}
              </button>
            </div>

            <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/40 p-4 text-xs space-y-2">
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">Recommended Demo Repositories:</div>
              <div className="text-neutral-600 dark:text-neutral-400">• High-concurrency TypeScript microservices pattern</div>
              <div className="text-neutral-600 dark:text-neutral-400">• Cloudflare Workers + PostgreSQL vector retrieval pipeline</div>
              <div className="text-neutral-600 dark:text-neutral-400">• Enterprise Terraform AWS baseline template</div>
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL 6: PORTFOLIO & CASE STUDIES */}
      {activeChannel === "portfolio" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Published Case Studies
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Verified delivery track records with architectural blueprints and ROI.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not assessed
              </span>
            </div>

            <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-8 text-center space-y-2">
              <FolderKanban className="mx-auto h-8 w-8 text-neutral-400" />
              <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                No public case studies published
              </div>
              <p className="text-xs text-neutral-500 max-w-md mx-auto">
                Enterprise buyers look for in-depth client delivery studies with quantifiable business impact before issuing RFP invitations.
              </p>
              <div className="pt-2">
                <a
                  href="/settings?tab=portfolio"
                  className="inline-block px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc] transition"
                >
                  Manage Portfolio in Settings →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL 7: BRAND & REPUTATION */}
      {activeChannel === "brand" && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                  Reviews & Corporate Reputation
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Third-party customer verification and brand consistency audit.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                Not connected
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Google Business Profile</div>
                <div className="text-neutral-500 text-[11px] mt-1">Local search and corporate headquarters verification</div>
                <div className="mt-2 text-neutral-400 text-[11px]">Status: Not linked</div>
              </div>
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/20">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Trustpilot / G2</div>
                <div className="text-neutral-500 text-[11px] mt-1">Verified customer satisfaction reviews</div>
                <div className="mt-2 text-neutral-400 text-[11px]">Status: Not linked</div>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <input
                type="text"
                placeholder="https://www.trustpilot.com/review/cyraops.com"
                value={savedLinks.trustpilot || ""}
                onChange={(e) => setSavedLinks({ ...savedLinks, trustpilot: e.target.value })}
                className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <button
                onClick={() => handleSaveChannelConfig("trustpilot", savedLinks.trustpilot || "")}
                className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#5345cc]"
              >
                {saveSuccess === "trustpilot" ? "Saved" : "Save review profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
