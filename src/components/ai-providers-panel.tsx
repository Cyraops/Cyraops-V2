"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";

interface ProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyHint: string;
  isActive: boolean;
}

export function AiProvidersPanel() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", baseUrl: "", defaultModel: "", apiKey: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/providers");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load providers");
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setEncryptionAvailable(Boolean(data.encryptionAvailable));
    } catch (err: any) {
      setError(err?.message || "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to add the provider");
      setNotice(`${data.provider.label} added — it now appears in the bot's model list.`);
      setForm({ label: "", baseUrl: "", defaultModel: "", apiKey: "" });
      setAdding(false);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add the provider");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai/providers/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove the provider");
      }
      setProviders((prev) => prev.filter((provider) => provider.id !== id));
    } catch (err: any) {
      setError(err?.message || "Failed to remove the provider");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
              <KeyRound size={15} className="text-accent" /> AI providers (bring your own key)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Add any OpenAI-compatible provider. Keys are encrypted at rest and never displayed again.
              Once added, each person can pick it in the bot&apos;s model menu.
            </p>
          </div>
          <button
            onClick={() => setAdding((value) => !value)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5345cc]"
          >
            <Plus size={13} /> Add provider
          </button>
        </div>

        {!encryptionAvailable && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
            Server-side key encryption is not configured, so provider keys cannot be stored yet. The operator must set
            <code className="mx-1 font-mono">AI_KEY_ENCRYPTION_SECRET</code> on the server.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-2.5 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
        )}
        {notice && (
          <p className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-700 dark:text-emerald-400">{notice}</p>
        )}

        {adding && (
          <div className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="Label (e.g. Groq Llama)"
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs outline-none"
              />
              <input
                value={form.defaultModel}
                onChange={(event) => setForm({ ...form, defaultModel: event.target.value })}
                placeholder="Model id (e.g. llama-3.3-70b)"
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs outline-none"
              />
            </div>
            <input
              value={form.baseUrl}
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              placeholder="Base URL (https://api.example.com/v1)"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs outline-none"
            />
            <input
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder="API key"
              type="password"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAdding(false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                Cancel
              </button>
              <button
                onClick={() => void add()}
                disabled={busy || !form.label || !form.baseUrl || !form.defaultModel || !form.apiKey}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy ? <RefreshCw size={12} className="animate-spin" /> : null} Verify & save
              </button>
            </div>
            <p className="text-[10px] text-[var(--muted)]">
              The key is tested against the provider before it is stored.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)]">
        {loading ? (
          <p className="p-5 text-center text-xs text-[var(--muted)]">Loading…</p>
        ) : providers.length === 0 ? (
          <p className="p-5 text-center text-xs text-[var(--muted)]">
            No custom providers yet. Cyraops currently uses the server-configured DeepSeek models.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {providers.map((provider) => (
              <div key={provider.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text)]">{provider.label}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]">{provider.baseUrl}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    model: <span className="font-mono">{provider.defaultModel}</span> · key {provider.apiKeyHint}
                  </p>
                </div>
                <button
                  onClick={() => void remove(provider.id)}
                  disabled={busy}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40"
                  title="Remove provider"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
