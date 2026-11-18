"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, Command, ShieldCheck, KeyRound } from "lucide-react";
import { Button, Field, useToast } from "@/components/ui";
import { formatRetryAfter } from "@/lib/login-lockout";

type Mode = "login" | "setup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [inviteUser, setInviteUser] = useState<{ name: string; email: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [lockoutEndsAt, setLockoutEndsAt] = useState<number | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    if (lockoutEndsAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutEndsAt - Date.now()) / 1000));
      setLockoutSeconds(remaining);
      if (remaining === 0) setLockoutEndsAt(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lockoutEndsAt]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      setSetupToken(token);
      fetch(`/api/auth/setup?token=${encodeURIComponent(token)}`)
        .then((res) => res.json())
        .then((data) => {
          setReady(true);
          if (data.valid && data.user) {
            setInviteUser(data.user);
          } else {
            setTokenError(data.error ?? "This setup link is invalid or has expired.");
          }
        })
        .catch(() => {
          setReady(true);
          setTokenError("Could not verify setup link. Please try again.");
        });
      return;
    }

    if (mode === "setup") {
      fetch("/api/auth/setup")
        .then((response) => response.json())
        .then((data) => {
          setReady(true);
          if (data.initialized) router.replace("/login");
        })
        .catch(() => setReady(true));
      return;
    }

    // Login mode
    Promise.all([fetch("/api/auth/setup"), fetch("/api/auth/me")])
      .then(async ([setupResponse, meResponse]) => {
        const setup = await setupResponse.json();
        if (!setup.initialized) router.replace("/setup");
        else if (meResponse.ok) router.replace("/dashboard");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [mode, router]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const data: Record<string, string> = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));

    let endpoint = "/api/auth/login";
    if (setupToken || mode === "setup") {
      endpoint = "/api/auth/setup";
    }

    if (setupToken) {
      data.token = setupToken;
      if (data.password !== data.confirmPassword) {
        setBusy(false);
        return toast("Passwords do not match", "error");
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      if (response.status === 429 && typeof result.retryAfterSeconds === "number" && result.retryAfterSeconds > 0) {
        setLockoutEndsAt(Date.now() + result.retryAfterSeconds * 1000);
        return;
      }
      return toast(result.error ?? "Something went wrong", "error");
    }

    toast(setupToken ? "Account configured successfully" : mode === "setup" ? "Workspace initialized" : "Signed in");
    router.push("/dashboard");
    router.refresh();
  };

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">Preparing secure sign-in…</div>;
  }

  const isTokenSetup = Boolean(setupToken);

  return <main className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
    <section className="relative hidden overflow-hidden bg-[#211d3c] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-32 -top-28 h-[500px] w-[500px] rounded-full border border-white/10" />
      <div className="absolute -right-12 -top-8 h-[340px] w-[340px] rounded-full border border-white/10" />
      <div className="absolute -bottom-44 -left-28 h-[470px] w-[470px] rounded-full bg-[#6659d9]/30 blur-3xl" />
      <div className="relative flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent"><Command size={20} /></span><span className="font-display text-lg font-extrabold tracking-tight">Cyraops CRM</span></div>
      <div className="relative max-w-lg"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#c4bdff]"><Building2 size={20} /></div><h1 className="font-display text-4xl font-extrabold leading-tight tracking-[-.04em]">One place for the work that moves you forward.</h1><p className="mt-4 max-w-md text-sm leading-6 text-white/65">Projects, tasks, files, and conversations — connected in one workspace.</p><div className="mt-8 flex items-center gap-3 text-xs text-white/65"><ShieldCheck size={15} className="text-[#c4bdff]" />Individual employee accounts with role-based security.</div></div>
      <div className="relative text-[11px] text-white/45">A calmer way to run your company.</div>
    </section>
    <section className="flex items-center justify-center p-5 sm:p-10"><div className="w-full max-w-[400px]">
      <div className="mb-8 flex items-center gap-2.5 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white"><Command size={17} /></span><span className="font-display font-extrabold">Cyraops CRM</span></div>

      {tokenError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
          <KeyRound size={28} className="mx-auto text-rose-500 mb-3" />
          <h2 className="font-display text-lg font-bold text-rose-900 dark:text-rose-200">Invalid Setup Link</h2>
          <p className="mt-2 text-xs leading-5 text-rose-700 dark:text-rose-300">{tokenError}</p>
          <Button className="mt-5 w-full justify-center" onClick={() => router.push("/login")}>Go to sign in</Button>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h2 className="font-display text-[28px] font-extrabold tracking-[-.04em]">
              {isTokenSetup ? "Set your password" : mode === "login" ? "Welcome back" : "Set up your workspace"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {isTokenSetup
                ? `Welcome, ${inviteUser?.name ?? "Teammate"}. Configure your private account password to get started.`
                : mode === "login"
                ? "Sign in with your corporate email and password."
                : "Create the owner profile and initialize your workspace."}
            </p>
          </div>

          {lockoutSeconds > 0 && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              Too many attempts — try again in {formatRetryAfter(lockoutSeconds)}.
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {isTokenSetup ? (
              <>
                <Field label="Corporate email" name="email" type="email" readOnly value={inviteUser?.email ?? ""} className="opacity-80" />
                <Field label="Choose a password" name="password" type="password" required autoFocus autoComplete="new-password" minLength={12} maxLength={128} placeholder="At least 12 characters" />
                <Field label="Confirm password" name="confirmPassword" type="password" required autoComplete="new-password" minLength={12} maxLength={128} placeholder="Re-enter your password" />
                <Button className="mt-2 h-11 w-full justify-between px-4" disabled={busy}>
                  {busy ? "Saving password…" : "Save password and sign in"}
                  <ArrowRight size={16} />
                </Button>
              </>
            ) : mode === "setup" ? (
              <>
                <Field label="Setup key" name="key" required autoComplete="off" placeholder="Enter the key configured by your admin" />
                <Field label="Owner profile name" name="name" required autoComplete="name" placeholder="Your name" maxLength={80} />
                <Field label="Owner corporate email" name="email" type="email" required autoComplete="email" placeholder="owner@cyraops.com" />
                <Field label="Owner password" name="password" type="password" required autoComplete="new-password" minLength={12} maxLength={128} placeholder="At least 12 characters" />
                <Button className="mt-2 h-11 w-full justify-between px-4" disabled={busy}>{busy ? "Please wait…" : "Create workspace"}<ArrowRight size={16} /></Button>
              </>
            ) : (
              <>
                <Field label="Corporate email" name="email" type="email" required autoFocus autoComplete="email" placeholder="you@cyraops.com" />
                <Field label="Password" name="password" type="password" required autoComplete="current-password" minLength={1} maxLength={128} placeholder="Your account password" />
                <Button className="mt-2 h-11 w-full justify-between px-4" disabled={busy || lockoutSeconds > 0}>{busy ? "Please wait…" : "Sign in"}<ArrowRight size={16} /></Button>
              </>
            )}
          </form>

          <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-[var(--muted)]">
            <CheckCircle2 size={14} className="text-emerald-600" />
            Individual authenticated accounts
          </div>
          {mode === "login" && !isTokenSetup && (
            <p className="mt-5 text-center text-xs text-[var(--muted)]">Need an account? Ask your workspace administrator for an invitation.</p>
          )}
        </>
      )}
    </div></section>
  </main>;
}
