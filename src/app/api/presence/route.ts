import { NextResponse } from "next/server";
import { providerManager } from "@/lib/ai/provider-manager";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shouldPing = searchParams.get("check") === "true";

  let websiteLive = false;
  let websiteStatusText = "Not checked";

  if (shouldPing) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch("https://cyraops.com", {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "Cyraops-Presence-Auditor/1.0" },
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.status >= 200 && res.status < 400) {
        websiteLive = true;
        websiteStatusText = "Operational (200 OK)";
      } else if (res) {
        websiteStatusText = `Status ${res.status}`;
      }
    } catch {
      websiteStatusText = "Unreachable";
    }
  }

  // Social profiles are plain saved links on the workspace; reflect what actually exists.
  const SOCIAL_PROFILE_KEYS: Record<string, string> = {
    linkedin: "LinkedIn",
    twitter: "X",
    instagram: "Instagram",
  };
  let linkedSocials: string[] = [];
  try {
    const workspace = await db.workspace.findUnique({ where: { id: "main" }, select: { socialLinks: true } });
    if (workspace?.socialLinks) {
      const parsed = JSON.parse(workspace.socialLinks);
      if (parsed && typeof parsed === "object") {
        linkedSocials = Object.entries(SOCIAL_PROFILE_KEYS)
          .filter(([key]) => typeof parsed[key] === "string" && parsed[key].trim().length > 0)
          .map(([, label]) => label);
      }
    }
  } catch {
    linkedSocials = [];
  }

  // Honest presence status
  const channels = [
    {
      id: "website",
      title: "Website",
      description: "Live preview, uptime, SEO and analytics",
      status: "Not connected",
      realStatus: websiteLive ? "Live (cyraops.com)" : "Unverified",
      connected: false,
    },
    {
      id: "search",
      title: "Search engines",
      description: "Indexing and search performance",
      status: "Not connected",
      realStatus: "Pending verification",
      connected: false,
    },
    {
      id: "social",
      title: "LinkedIn & social",
      description: "Company profiles and engagement",
      status: linkedSocials.length > 0 ? "Profile saved" : "Not connected",
      realStatus: linkedSocials.length > 0 ? `Linked: ${linkedSocials.join(", ")}` : "No profiles linked",
      connected: linkedSocials.length > 0,
    },
    {
      id: "marketplaces",
      title: "Freelance marketplaces",
      description: "Upwork and agency profiles",
      status: "Not connected",
      realStatus: "Agency profile missing",
      connected: false,
    },
    {
      id: "github",
      title: "GitHub & technical presence",
      description: "Repositories and demonstrations",
      status: "Not connected",
      realStatus: "No public repo showcase",
      connected: false,
    },
    {
      id: "portfolio",
      title: "Portfolio & case studies",
      description: "Published work and credibility",
      status: "Not connected",
      realStatus: "0 published case studies",
      connected: false,
    },
    {
      id: "brand",
      title: "Brand & reputation",
      description: "Reviews and brand consistency",
      status: "Not connected",
      realStatus: "No reviews linked",
      connected: false,
    },
  ];

  return NextResponse.json({
    connectedChannels: "—",
    connectedChannelsSubtext: "Awaiting integrations",
    presenceIssues: "—",
    presenceIssuesSubtext: "Awaiting audits",
    websiteStatus: websiteStatusText,
    portfolioStatus: "Not assessed",
    channels,
  });
}

export async function POST(req: Request) {
  try {
    // This endpoint triggers a paid model call, so it must require a session.
    const user = await userFromRequest(req as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt } = await req.json();

    const query = typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : "What is preventing our company from looking credible to enterprise clients?";

    const systemPrompt = `You are the Cyraops AI Presence Manager, an expert corporate digital reputation auditor and enterprise IT sales advisor for Cyraops (an IT services & consulting company).
You provide clear, authoritative, and actionable presence audits to help Cyraops build trust and close contracts with enterprise clients.
Keep recommendations concise, pragmatic, and directly addressing:
1. Public digital footprint gaps (LinkedIn, Clutch, GitHub, Search Engines).
2. Enterprise vendor evaluation criteria (security, case studies, verified track record).
3. The exact steps Cyraops should take to establish credibility immediately.`;

    let aiAnswer: string | null = null;

    try {
      const provider = providerManager.getProvider();
      const response = await provider.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        {
          temperature: 0.3,
          maxTokens: 750,
          userId: user.id,
          source: "presence",
        }
      );
      aiAnswer = response.content;
    } catch {
      // Fallback to high-quality structured presence audit
      aiAnswer = `### Enterprise Credibility Audit for Cyraops

Enterprise procurement and IT leaders perform rigorous background checks before signing multi-thousand dollar contracts. Currently, several critical digital presence gaps prevent Cyraops from looking fully enterprise-ready:

1. **Unverified Public Footprint**
   - None of your 7 public channels (Search engines, LinkedIn, Upwork, GitHub, Clutch) are connected or verified.
   - When enterprise buyers search for Cyraops, lack of independent third-party validation (Clutch, G2, Google Business) raises flags about operating history.

2. **Absence of Published Architecture Case Studies**
   - Enterprise clients require proof of execution. Without published case studies featuring problem statements, system architectures, and quantified business outcomes (e.g., latency reduction, cost savings), buyers assume high delivery risk.

3. **Missing Technical Proof & Open Source Footprint**
   - CTOs evaluate agency engineering standards through public GitHub repositories, CI/CD pipelines, and technical demonstrations. An empty technical presence makes it difficult to defend premium rates.

4. **Actionable Roadmap to Enterprise Credibility**
   - **Step 1 (Immediate)**: Connect and polish your LinkedIn Company Page with executive profiles and corporate branding.
   - **Step 2 (Week 1)**: Verify Google Search Console and submit your XML sitemap (\`https://cyraops.com/sitemap.xml\`) for indexing.
   - **Step 3 (Week 2)**: Publish 2 technical case studies on cyraops.com with architecture diagrams and client testimonials.
   - **Step 4 (Month 1)**: Set up a Clutch.co agency profile to collect verified third-party reviews.`;
    }

    return NextResponse.json({
      prompt: query,
      answer: aiAnswer,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to process presence query" }, { status: 500 });
  }
}
