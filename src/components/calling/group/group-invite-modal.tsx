"use client";

import { useState } from "react";
import { X, UserPlus, Check } from "lucide-react";
import { Avatar } from "@/components/ui";

export interface AvailableMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface GroupInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableMembers: AvailableMember[];
  onInvite: (userIds: string[]) => Promise<void>;
}

export function GroupInviteModal({
  isOpen,
  onClose,
  availableMembers,
  onInvite,
}: GroupInviteModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSend = async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onInvite(Array.from(selectedIds));
      setSelectedIds(new Set());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite teammates to group call"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl text-slate-100">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <UserPlus size={18} />
          </div>
          <div>
            <h3 className="font-semibold text-base">Invite Teammates</h3>
            <p className="text-xs text-slate-400">Select teammates to ring in this group meeting</p>
          </div>
        </div>

        {availableMembers.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            All teammates in this conversation are already in the meeting.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2 py-2 pr-1">
            {availableMembers.map((m) => {
              const selected = selectedIds.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggleSelect(m.id)}
                  className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition ${
                    selected
                      ? "border-indigo-500 bg-indigo-500/10 text-white"
                      : "border-slate-800/80 bg-slate-900/50 hover:bg-slate-900 text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{m.name}</span>
                      <span className="text-[11px] text-slate-400">{m.email}</span>
                    </div>
                  </div>

                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                      selected
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-slate-700 bg-slate-800"
                    }`}
                  >
                    {selected && <Check size={12} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={selectedIds.size === 0 || submitting}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-40 transition"
          >
            <UserPlus size={14} />
            {submitting ? "Inviting..." : `Invite Selected (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

