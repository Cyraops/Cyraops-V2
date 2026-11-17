import catalog from "../data/catalog.json";

export interface NavLink { label: string; href: string; note?: string; }

export interface NavGroup {
  kind: "group" | "link";
  label: string;
  blurb: string;
  links: NavLink[];
  featured?: { label: string; href: string; note: string };
  /** A plain top-level link (no dropdown), e.g. Catalogue. */
  plainHref?: string;
}

const axes = (catalog as any).axes as Array<{
  axis: string;
  label: string;
  intro: { sub: string };
  items: Array<{ name: string; outcome: string }>;
}>;

const slug = (value: string) =>
  value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One group per axis, labelled from the axis itself so the menu can never drift
 *  away from the page title and breadcrumbs again. */
const group = (id: string, blurb: string, options?: { featured?: NavGroup["featured"]; exclude?: string[] }): NavGroup => {
  const axis = axes.find((a) => a.axis === id)!;
  const exclude = options?.exclude ?? [];
  return {
    kind: "group",
    label: axis.label,
    blurb,
    featured: options?.featured,
    links: axis.items
      .filter((item) => !exclude.includes(item.name))
      .map((item) => ({
        label: item.name,
        href: `/${id}/${slug(item.name)}`,
        note: item.outcome.length > 62 ? `${item.outcome.slice(0, 59)}…` : item.outcome,
      })),
  };
};

export const NAV_GROUPS: NavGroup[] = [
  group("industries", "Where the work repeats — five sectors we can staff today."),
  group("enterprise-ai", "The AI capability we can put on a project next month."),
  group("products", "One platform we run, and the tools we reuse on every build.", {
    featured: {
      label: "CyraOps CRM",
      href: "/products/cyraops-crm",
      note: "Our own operations platform with an agent runtime — in production, not a demo.",
    },
    // The CRM is the featured card; don't also list it in the links column.
    exclude: ["CyraOps CRM"],
  }),
  group("solutions", "Projects with a defined end, a named lead and a price."),
  group("ai-foundation", "The engineering layer everything else depends on."),
  group("functions", "Six departments, each with the jobs we are actually asked to do."),
  {
    kind: "group",
    label: "About",
    blurb: "Who you are actually hiring, and how we work.",
    links: [
      { label: "Why CyraOps", href: "/about", note: "We run what we sell." },
      { label: "How we work", href: "/about/how", note: "Scope, prove, build, run." },
      { label: "Ways of engaging", href: "/about/engagement", note: "Project, retainer, or embedded." },
      { label: "Frequently asked", href: "/about/faq", note: "Platforms, access, pricing, support." },
    ],
  },
  // The catalogue is important enough to be a top-level link, not a dropdown item.
  { kind: "link", label: "Catalogue", blurb: "", links: [], plainHref: "/catalogue" },
];

export const ALL_OFFERINGS = axes.flatMap((axis) =>
  axis.items.map((item) => ({
    axis: axis.axis,
    axisLabel: axis.label,
    name: item.name,
    outcome: item.outcome,
    href: `/${axis.axis}/${slug(item.name)}`,
  }))
);

export { slug };
