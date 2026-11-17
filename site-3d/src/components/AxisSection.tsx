import { useState } from "react";
import { Reveal } from "./Chrome";

export interface AxisItem {
  name: string;
  outcome: string;
  what: string;
  capabilities: string[];
  tier?: "core" | "selective";
}

export interface AxisData {
  axis: string;
  label: string;
  intro: { eyebrow: string; headline: string; sub: string };
  items: AxisItem[];
}

/**
 * One catalogue axis.
 *
 * Six axes of ten items each would be an unreadable wall, so each axis is a
 * single list: the name and the outcome are always visible, and the depth opens
 * on click. The left column stays pinned while you read, so you never lose the
 * thread of which axis you are in.
 */
export function AxisSection({ data, index }: { data: AxisData; index: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const core = data.items.filter((item) => item.tier !== "selective").length;

  return (
    <section className="axis section" id={data.axis}>
      <div className="shell split">
        <div className="axis-sticky">
          <Reveal>
            <span className="eyebrow">{data.intro.eyebrow}</span>
            <h2 className="h2" style={{ marginTop: 18 }} dangerouslySetInnerHTML={{ __html: renderEmphasis(data.intro.headline) }} />
            <p className="lead" style={{ marginTop: 20, maxWidth: "38ch" }}>{data.intro.sub}</p>
            <div className="axis-count" style={{ marginTop: 26 }}>
              {String(index + 1).padStart(2, "0")} / {data.items.length} offerings{core !== data.items.length ? ` · ${data.items.length - core} selective` : ""}
            </div>
          </Reveal>
        </div>

        <div className="axis-list">
          {data.items.map((item, i) => {
            const isOpen = open === item.name;
            return (
              <Reveal key={item.name} delay={Math.min(i * 0.035, 0.2)}>
                <button
                  className={`axis-item ${isOpen ? "is-open" : ""}`}
                  onClick={() => setOpen(isOpen ? null : item.name)}
                  aria-expanded={isOpen}
                >
                  <span className="axis-index">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="axis-name">{item.name}</span>
                    <span className="axis-outcome" style={{ display: "block" }}>{item.outcome}</span>
                    <span className="axis-body">
                      <span className="axis-body-inner">
                        <span className="axis-body-content">
                          <span className="body" style={{ display: "block" }}>{item.what}</span>
                          <span className="axis-caps">
                            {item.capabilities.map((cap) => (
                              <span className="chip" key={cap}>{cap}</span>
                            ))}
                            {item.tier === "selective" && <span className="chip chip-lime">Selective — scoped case by case</span>}
                          </span>
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="axis-plus" aria-hidden="true">+</span>
                </button>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Allows *italic* emphasis inside model-written headlines without a markdown dep. */
function renderEmphasis(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}
