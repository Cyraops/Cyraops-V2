"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, CalendarDays, Check, ChevronDown, Home, LogOut, Menu, MessageSquare, Moon, Plus, Search, Settings, Sun, Users, Command, ArrowUpRight, UserRound, FolderKanban, Globe, Sparkles, Mail, Wallet, Target, ListChecks } from "lucide-react";
import { Avatar, IconButton, Modal, useToast } from "@/components/ui";

type User = { id: string; name: string; email?: string | null; role: "OWNER" | "ADMIN" | "MEMBER"; avatarUrl?: string | null; title?: string | null };
type NavItem = { label: string; href: string; icon: typeof Home; roles?: Array<"OWNER" | "ADMIN" | "MEMBER"> };

const nav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home },
  { label: "CRM", href: "/crm", icon: Target },
  { label: "Cyraops Bot", href: "/ai", icon: Sparkles },
  // Tickets created in the bot (or on the board) are tracked here.
  { label: "Tickets", href: "/tasks", icon: ListChecks },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  // Agent runs and approvals deliberately have no nav entry of their own: they
  // live inside the Cyraops Bot, which is where work with agents starts.
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Email", href: "/email", icon: Mail },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Company Presence", href: "/website", icon: Globe },
  { label: "Cost", href: "/cost", icon: Wallet },
];

export function WorkspaceShell({ user, workspaceName, children }: { user: User; workspaceName: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => { const saved = localStorage.getItem("company-theme"); const shouldDark = saved === "dark"; setDark(shouldDark); document.documentElement.classList.toggle("dark", shouldDark); }, []);
  useEffect(() => {
    const refreshUnread = () => fetch("/api/notifications?limit=1").then((r) => r.json()).then((data) => setUnread(data.unreadCount ?? 0)).catch(() => {});
    void refreshUnread();
    const timer = window.setInterval(refreshUnread, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (!notificationsOpen) return; fetch("/api/notifications").then((r) => r.json()).then((data) => { setNotifications(data.notifications ?? []); setUnread(data.unreadCount ?? 0); }).catch(() => {}); }, [notificationsOpen]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.altKey && event.key.toLowerCase() === "v") { event.preventDefault(); router.push("/ai"); }
      if (event.key === "Escape") { setSearchOpen(false); setNotificationsOpen(false); setProfileOpen(false); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const toggleTheme = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle("dark", next); localStorage.setItem("company-theme", next ? "dark" : "light"); };
  const doLogout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); };
  const toggleProfileMenu = () => {
    const open = !profileOpen;
    setProfileOpen(open);
    setNotificationsOpen(false);
  };
  const markRead = async (id?: string) => {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) });
    if (!response.ok) return;
    const changed = id ? notifications.filter((item) => item.id === id && !item.readAt).length : notifications.filter((item) => !item.readAt).length;
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((item) => !id || item.id === id ? { ...item, readAt: item.readAt ?? readAt } : item));
    setUnread((count) => Math.max(0, count - changed));
  };
  const sidebar = <aside className="flex h-full w-[252px] flex-col border-r border-[var(--border)] bg-[var(--surface)] px-3 py-4">
    <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="mb-7 flex items-center gap-2.5 px-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-white shadow-sm"><Command size={17} strokeWidth={2.4} /></span><span className="min-w-0"><span className="block truncate font-display text-[14px] font-extrabold tracking-[-.03em]">Cyraops CRM</span><span className="block truncate text-[10px] font-semibold uppercase tracking-[.13em] text-[var(--muted)]">{workspaceName}</span></span></Link>
    <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--muted)]">Workspace</div>
    <nav className="flex-1 space-y-0.5">{nav.filter((item) => !item.roles || item.roles.includes(user.role)).map(({ label, href, icon: Icon }) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition ${active ? "bg-[#f0efff] text-accent dark:bg-[#302c4e] dark:text-[#c9c3ff]" : "text-[#5f6572] hover:bg-[var(--hover)] hover:text-[var(--text)] dark:text-[#a5a9b4]"}`}><Icon size={16} strokeWidth={active ? 2.2 : 1.8} /><span className="flex-1">{label}</span>{label === "Chat" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}</Link>; })}</nav>
    <div className="border-t border-[var(--border)] pt-3"><Link href="/team" onClick={() => setMobileOpen(false)} className={`mb-0.5 flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition ${pathname === "/team" ? "bg-[#f0efff] text-accent dark:bg-[#302c4e] dark:text-[#c9c3ff]" : "text-[#5f6572] hover:bg-[var(--hover)] dark:text-[#a5a9b4]"}`}><Users size={16} />Team</Link><Link href="/settings" onClick={() => setMobileOpen(false)} className={`flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition ${pathname === "/settings" ? "bg-[#f0efff] text-accent dark:bg-[#302c4e] dark:text-[#c9c3ff]" : "text-[#5f6572] hover:bg-[var(--hover)] dark:text-[#a5a9b4]"}`}><Settings size={16} />Settings</Link></div>
    <button onClick={toggleProfileMenu} className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--border)] p-2 text-left transition hover:bg-[var(--hover)]"><Avatar name={user.name} src={user.avatarUrl} size="sm"/><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{user.name}</span><span className="block truncate text-[10px] capitalize text-[var(--muted)]">{user.role.toLowerCase()}</span></span><ChevronDown size={14} className="text-[var(--muted)]" /></button>
  </aside>;
  return <div className="min-h-screen bg-[var(--surface-2)] text-[var(--text)]"><div className="flex min-h-screen">
    <div className="hidden shrink-0 lg:block">{sidebar}</div>
    {mobileOpen && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />{sidebar}</div>}
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex h-[62px] items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/90 px-4 backdrop-blur-md sm:px-7"><div className="flex min-w-0 items-center gap-3"> <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></IconButton><button onClick={() => setSearchOpen(true)} className="flex h-9 w-[min(380px,42vw)] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-left text-xs text-[var(--muted)] hover:border-[#c7c3eb]"><Search size={15} /><span className="flex-1 truncate">Search anything...</span><kbd className="hidden rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] sm:block">⌘ K</kbd></button></div><div className="flex items-center gap-1 sm:gap-2"><IconButton label="Cyraops bot — your assistant" onClick={() => router.push("/ai")}><Sparkles size={17} /></IconButton><IconButton label="Create a project" onClick={() => router.push("/projects?create=1")} className="bg-accent text-white hover:bg-[#5345cc] hover:text-white"><Plus size={17} /></IconButton><div className="relative"><IconButton label="Notifications" onClick={() => { setNotificationsOpen(!notificationsOpen); setProfileOpen(false); }}><Bell size={17} />{unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-[var(--surface)] bg-rose-500" />}</IconButton>{notificationsOpen && <div className="absolute right-[-45px] top-12 z-40 w-[min(360px,calc(100vw-28px))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-soft sm:right-0"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><div><h3 className="font-display text-sm font-bold">Notifications</h3><p className="text-[11px] text-[var(--muted)]">{unread} unread</p></div><button className="text-[11px] font-semibold text-accent" onClick={() => markRead()}>Mark all read</button></div><div className="max-h-[370px] overflow-auto">{notifications.length ? notifications.map((item) => <button key={item.id} onClick={() => { markRead(item.id); if (item.href) router.push(item.href); setNotificationsOpen(false); }} className={`flex w-full gap-3 border-b border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--hover)] ${item.readAt ? "opacity-70" : ""}`}><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-accent"}`} /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{item.body}</span><span className="mt-1 block text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString()}</span></span></button>) : <div className="px-4 py-10 text-center text-xs text-[var(--muted)]">You’re all caught up</div>}</div></div>}</div><IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme} className="hidden sm:inline-flex">{dark ? <Sun size={17} /> : <Moon size={17} />}</IconButton><button onClick={toggleProfileMenu} className="ml-1"><Avatar name={user.name} src={user.avatarUrl} size="sm" /></button></div></header>
      <main className="mx-auto max-w-[1440px] p-4 sm:p-7 lg:px-9">{children}</main>
    </div>
  </div>
  {profileOpen && <><button className="fixed inset-0 z-30 cursor-default" aria-label="Close menu" onClick={() => setProfileOpen(false)} /><div className="fixed bottom-5 left-3 z-40 w-[260px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-soft lg:bottom-20"><div className="border-b border-[var(--border)] px-3 py-2.5"><div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Signed in as</div><div className="mt-1 truncate text-xs font-bold">{user.name}</div>{user.email && <div className="truncate text-[11px] text-[var(--muted)]">{user.email}</div>}</div><div className="p-1"><Link onClick={() => setProfileOpen(false)} href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs hover:bg-[var(--hover)]"><UserRound size={14} />Account settings</Link><button onClick={doLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"><LogOut size={14} />Sign out</button></div></div></>}
  <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
}

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter(); const toast = useToast(); const [query, setQuery] = useState(""); const [results, setResults] = useState<any[]>([]); const [loading, setLoading] = useState(false);
  useEffect(() => { if (!open) { setQuery(""); setResults([]); return; } const timer = setTimeout(async () => { if (query.trim().length < 2) { setResults([]); return; } setLoading(true); const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`); const data = await response.json().catch(() => ({ results: [] })); setResults(data.results ?? []); setLoading(false); }, 180); return () => clearTimeout(timer); }, [query, open]);
  return <Modal open={open} onClose={onClose} title="Search your workspace" size="max-w-2xl"><div className="relative"><Search size={17} className="absolute left-3 top-3 text-[var(--muted)]"/><input autoFocus placeholder="Try a project, task, person, file..." value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] pl-10 pr-4 text-sm outline-none focus:border-accent" /></div><div className="mt-3 max-h-[55vh] overflow-auto">{loading ? <p className="px-3 py-6 text-center text-xs text-[var(--muted)]">Searching...</p> : results.length ? results.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => { if (!item.href) return toast("This result is not available", "error"); router.push(item.href); onClose(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--hover)]"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--hover)] text-accent"><Search size={14}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="block truncate text-[11px] capitalize text-[var(--muted)]">{item.type} · {item.detail}</span></span><ArrowUpRight size={14} className="text-[var(--muted)]"/></button>) : query.length > 1 ? <p className="px-3 py-8 text-center text-xs text-[var(--muted)]">No results for “{query}”</p> : <div className="px-3 py-7 text-center text-xs text-[var(--muted)]"><Command size={17} className="mx-auto mb-2"/>Type at least two characters to search across your workspace.</div>}</div></Modal>;
}

