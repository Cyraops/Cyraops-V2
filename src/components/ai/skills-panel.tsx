"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
}

/**
 * The Skills section of the bot right rail (below Workspace): a muted,
 * collapsible, read-only list of the skill capabilities mounted in the
 * harness boot. Names and descriptions come from GET /api/assistant/skills,
 * which is compiled from the vendored dsh-skill package metadata — no actions
 * are offered because the catalog is informational.
 *
 * The skill registry and filesystem provider stay mounted, but the
 * model-facing loader tool is disabled in the Cyraops boot; a disabled entry
 * renders an explicit "disabled" badge so the panel does not imply the loader
 * is active.
 */
export function SkillsPanel() {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/assistant/skills");
        const data = await response.json();
        if (!alive) return;
        if (Array.isArray(data.skills)) setSkills(data.skills);
      } catch {
        /* the catalog is optional; the section simply stays empty */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="rail-skills"
        className="mb-2 mt-4 flex w-full items-center gap-1.5 text-left text-caption font-bold uppercase tracking-widest text-[var(--muted)] transition hover:text-[var(--text)]"
      >
        <ChevronDown size={11} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        <Sparkles size={12} />
        <span className="flex-1">Skills</span>
        <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">
          {skills.length}
        </span>
      </button>
      {open && (
        <div id="rail-skills" className="space-y-1">
          {!loaded ? (
            <p className="px-1 text-caption text-[var(--muted)]">Loading skills…</p>
          ) : skills.length === 0 ? (
            <p className="px-1 text-caption text-[var(--muted)]">No skills are mounted.</p>
          ) : (
            skills.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-[var(--border)] px-2 py-1.5">
                <p className="flex items-center gap-1.5 text-meta font-semibold text-[var(--text)]">
                  <span>{skill.name}</span>
                  {skill.disabled ? (
                    <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-[var(--muted)]">
                      disabled
                    </span>
                  ) : null}
                </p>
                <p className="text-caption leading-relaxed text-[var(--muted)]">{skill.description}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
