import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const EMAIL = process.env.EMAIL || "tanveer@cyraops.com";
const PASSWORD = process.env.PASSWORD || "CyraOps-dev-2026";
const FAKE_AUDIO = process.env.FAKE_AUDIO || "/tmp/utt44.wav";
const NEUTRALIZE_RECOGNITION = process.env.NEUTRALIZE_RECOGNITION === "1";
const HARNESS = process.env.HARNESS === "1";
const ASR_EMPTY_ONCE = process.env.ASR_EMPTY_ONCE === "1";
const SKIP_TURNS = process.env.SKIP_TURNS === "1";

const out = {
  steps: [],
  loginOk: false,
  voiceModeOpened: false,
  gumCalls: 0,
  plays: [],
  speechSynthesisSpeaks: [],
  ttsPosts: 0,
  ttsPostFailures: 0,
  asrPosts: [],
  chatStreams: [],
  userBubbles: [],
  assistantBubbles: [],
  turn1: null,
  turn2: null,
  fallbackTurn: null,
  approvalSeen: false,
  approvalCard: null,
  approvePosts: [],
  consoleErrors: [],
  pageErrors: [],
  probeErrors: [],
  fatal: null,
  screenshot: "",
};

const log = (msg) => {
  console.log(`[flow] ${msg}`);
  out.steps.push(msg);
};

async function snapshot(page) {
  return page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('div[class*="max-w-[85%]"]')).map((el) => ({
      cls: el.className || "",
      text: (el.textContent || "").trim(),
    }));
    const approvalP = Array.from(document.querySelectorAll("p")).find((p) => (p.textContent || "").includes("Approval required"));
    return {
      bubbles,
      spinner: Boolean(document.querySelector(".animate-spin")),
      phase: (document.querySelector('[role="status"]')?.textContent || "").trim(),
      error: (document.querySelector('[role="alert"]')?.textContent || "").trim(),
      draft: (document.querySelector('textarea[placeholder*="Type, or tap"]')?.value || ""),
      approval: Boolean(approvalP),
      approvalSummary: approvalP ? (approvalP.parentElement?.textContent || "").slice(0, 300) : "",
    };
  });
}

const userCount = (snap) => snap.bubbles.filter((b) => b.cls.includes("bg-accent")).length;
const assistantCount = (snap) => snap.bubbles.filter((b) => b.cls.includes("border-[var(--border)]") && !b.cls.includes("dashed")).length;
const assistantTexts = (snap) => snap.bubbles.filter((b) => b.cls.includes("border-[var(--border)]") && !b.cls.includes("dashed")).map((b) => b.text);
const userTexts = (snap) => snap.bubbles.filter((b) => b.cls.includes("bg-accent")).map((b) => b.text);

async function waitFor(page, predicate, what, timeoutMs, interval = 200) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot(page).catch(() => null);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(interval);
  }
  throw new Error(`Timed out waiting for: ${what}. last=${JSON.stringify(last && { a: assistantCount(last), u: userCount(last), spinner: last.spinner, phase: last.phase, error: last.error, draft: last.draft })}`);
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["microphone"],
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const loc = msg.location() || {};
      out.consoleErrors.push(`${msg.text().slice(0, 300)} @${loc.url || "?"}:${loc.lineNumber || "?"}`);
    }
  });
  page.on("pageerror", (err) => out.pageErrors.push(String(err).slice(0, 400)));

  await context.addInitScript(({ neutralize }) => {
    window.__probe = {
      gumCalls: 0,
      plays: [],
      speechSynthesisSpeaks: [],
      ttsPosts: 0,
      ttsPostFailures: 0,
      asrPosts: [],
      chatStreams: [],
      errors: [],
    };
    if (neutralize) {
      // Test isolation: with the fake audio file looping, the barge-in
      // recognizer would hear the loop and legitimately treat it as a new
      // utterance. The metrics below concern the mic session + TTS flow.
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
    }
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      window.__probe.gumCalls += 1;
      return gum(constraints);
    };
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__probe.plays.push({ at: Date.now(), tag: this.tagName, src: (this.currentSrc || "").slice(0, 120) });
      return origPlay.apply(this, arguments);
    };
    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => {
      window.__probe.speechSynthesisSpeaks.push({ at: Date.now(), text: (u.text || "").slice(0, 300), voice: u.voice ? u.voice.name : null, lang: u.lang || null });
      return origSpeak(u);
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("/api/assistant/chat/stream")) {
        window.__probe.chatStreams.push({ startedAt: Date.now() });
        return origFetch(input, init);
      }
      if (url.includes("/api/assistant/tts") && init && init.method === "POST") {
        window.__probe.ttsPosts += 1;
        return origFetch(input, init).then((res) => {
          if (!res.ok) window.__probe.ttsPostFailures += 1;
          return res;
        });
      }
      if (url.includes("/api/assistant/asr") && init && init.method === "POST") {
        const startedAt = Date.now();
        return origFetch(input, init).then(async (res) => {
          let text = null;
          try {
            const clone = res.clone();
            const data = await clone.json();
            text = data.text ?? null;
          } catch {}
          window.__probe.asrPosts.push({ startedAt, text, ok: res.ok });
          return res;
        });
      }
      return origFetch(input, init);
    };
    window.addEventListener("error", (e) => window.__probe.errors.push(`window.error: ${e.message || e.type}`));
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason;
      window.__probe.errors.push(`unhandledrejection: ${r && r.message ? r.message : String(r).slice(0, 120)}`);
    });
  }, { neutralize: NEUTRALIZE_RECOGNITION });

  let approveHits = [];
  const approveHandler = (route) => {
    approveHits.push({ at: Date.now(), body: route.request().postData() || "" });
    route.continue();
  };

  // Resilience: serve one empty transcription, then let real ASR through.
  let asrEmptyServed = false;
  if (ASR_EMPTY_ONCE) {
    await context.route("**/api/assistant/asr", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (!asrEmptyServed) {
        asrEmptyServed = true;
        log("ASR interception: first POST fulfilled with empty text");
        return route.fulfill({ json: { text: "" } });
      }
      return route.continue();
    });
  }

  try {
    // ---- login ----
    log(`goto ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('input[name="email"]', { timeout: 30000 });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
      page.press('input[name="password"]', "Enter"),
    ]);
    await page.waitForTimeout(1200);
    log(`after login: ${page.url()}`);
    if (/login/i.test(page.url())) {
      const body = (await page.textContent("body").catch(() => "")) || "";
      throw new Error(`login failed: ${body.slice(0, 300)}`);
    }
    out.loginOk = true;

    // ---- open /ai voice screen ----
    log(`goto ${BASE}/ai`);
    await page.goto(`${BASE}/ai`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[aria-label="Voice orb"]', { timeout: 60000 });
    out.voiceModeOpened = true;

    const base = await waitFor(page, (s) => assistantCount(s) >= 0, "initial snapshot", 15000);
    const baseA = assistantCount(base);
    const baseU = userCount(base);
    log(`baseline: assistants=${baseA} users=${baseU} phase="${base.phase}"`);

    // ---- turn 1 ----
    const tapAt = Date.now();
    if (!SKIP_TURNS) {
      await page.click('[aria-label="Voice orb"]');
      log("planet tapped; recording turn 1…");
      const t1 = await waitFor(
        page,
        (s) => assistantCount(s) >= baseA + 1 && !s.spinner,
        "turn 1 done (new assistant bubble + no spinner)",
        300000
      );
      out.turn1 = {
        doneAt: Date.now(),
        tapToDoneMs: Date.now() - tapAt,
        texts: assistantTexts(t1).slice(baseA),
      };
      log(`turn 1 done: ${Date.now() - tapAt}ms after tap; text="${out.turn1.texts.join(" ").slice(0, 200)}"`);

      // ---- turn 2 (no re-tap; session re-listens by itself) ----
      log("waiting for turn 2 (auto re-listen, no planet tap)…");
      const t2 = await waitFor(
        page,
        (s) => assistantCount(s) >= baseA + 2 && !s.spinner,
        "turn 2 done (second new assistant bubble + no spinner)",
        300000
      );
      out.turn2 = { doneAt: Date.now(), texts: assistantTexts(t2).slice(baseA + 1) };
      log(`turn 2 done; text="${out.turn2.texts.join(" ").slice(0, 200)}"`);
    }
    // ---- TTS failure fallback: abort hosted TTS, type a message ----
    await context.route("**/api/assistant/tts", (route) => {
      if (route.request().method() === "POST") return route.abort();
      return route.continue();
    });
    log("TTS interception ON (abort POST /api/assistant/tts); typing a draft turn");
    await page.fill('textarea[placeholder*="Type, or tap"]', "Thanks, that's all for now.");
    await page.press('textarea[placeholder*="Type, or tap"]', "Enter");
    const fbTarget = baseA + (SKIP_TURNS ? 1 : 3);
    const fb = await waitFor(
      page,
      (s) => assistantCount(s) >= fbTarget && !s.spinner,
      `fallback turn done (assistant bubble ${fbTarget} + no spinner)`,
      240000
    );
    out.fallbackTurn = { doneAt: Date.now(), texts: assistantTexts(fb).slice(fbTarget - 1) };
    log(`fallback turn done; text="${out.fallbackTurn.texts.join(" ").slice(0, 200)}"`);

    // The queue also carries turn 2's tail sentences; wait for the browser
    // voice to actually speak after the hosted TTS fetch failed.
    {
      const spokeStarted = Date.now();
      let spoken = [];
      while (Date.now() - spokeStarted < 60000) {
        spoken = await page.evaluate(() => window.__probe.speechSynthesisSpeaks);
        if (spoken.length > 0) break;
        await page.waitForTimeout(500);
      }
      out.ttsFallbackSpoken = spoken;
      log(`browser fallback speech observed: ${spoken.length} utterance(s); first voice=${spoken[0] ? spoken[0].voice : "?"}`);
    }

    // ---- resilience: one empty ASR round must not kill the session ----
    if (ASR_EMPTY_ONCE) {
      const errSeen = await waitFor(
        page,
        (s) => /could not make out/i.test(s.error),
        "empty-transcription error shown",
        240000
      );
      out.asrEmptyErrorShown = errSeen.error;
      log(`ASR-empty resilience: error shown → "${errSeen.error}"`);
      const recovery = await waitFor(
        page,
        (s) => assistantCount(s) >= fbTarget + 1 && !s.spinner,
        "a real turn completes after the empty round",
        240000
      );
      out.asrEmptyRecoveredTexts = assistantTexts(recovery).slice(fbTarget);
      log(`ASR-empty resilience: session returned to listening and the next round transcribed → turn "${out.asrEmptyRecoveredTexts.join(" ").slice(0, 160)}"`);
    }

    // ---- (harness mode only) approval: typed turn asking for a tool action ----
    if (HARNESS) {
      log("harness mode: asking for an approval-triggering action");
      await page.fill('textarea[placeholder*="Type, or tap"]', "Please update ticket seed-task-backups and set its priority to MEDIUM.");
      await page.press('textarea[placeholder*="Type, or tap"]', "Enter");
      await page.route("**/api/harness/approve", approveHandler);
      const appr = await waitFor(
        page,
        (s) => s.approval,
        "approval card visible",
        240000
      );
      out.approvalSeen = true;
      out.approvalCard = { summary: appr.approvalSummary };
      log(`approval card visible: ${appr.approvalSummary.slice(0, 160)}`);
      await page.click('button:has-text("Approve & run")');
      await page.waitForTimeout(4000);
      out.approvePosts = approveHits;
      log(`approve posted: ${approveHits.length} request(s)`);
    }

    // ---- gather probe data ----
    await page.waitForTimeout(1500);
    const probe = await page.evaluate(() => window.__probe);
    out.gumCalls = probe.gumCalls;
    out.plays = probe.plays;
    out.speechSynthesisSpeaks = probe.speechSynthesisSpeaks;
    out.ttsPosts = probe.ttsPosts;
    out.ttsPostFailures = probe.ttsPostFailures;
    out.asrPosts = probe.asrPosts;
    out.chatStreams = probe.chatStreams;
    out.probeErrors = probe.errors;

    const finalSnap = await snapshot(page);
    out.userBubbles = userTexts(finalSnap);
    out.assistantBubbles = assistantTexts(finalSnap);
    out.firstPlayAfterTapMs = out.plays.length ? out.plays[0].at - tapAt : null;
    out.firstPlayBeforeTurn1DoneMs =
      out.plays.length && out.turn1 ? out.turn1.doneAt - out.plays[0].at : null;

    out.screenshot = "scratch/e2e-voice-flow-final.png";
    await page.screenshot({ path: out.screenshot, fullPage: true });
    log("screenshot saved");
  } catch (err) {
    out.fatal = String((err && err.message) || err);
    console.error("[flow] FAILED:", out.fatal);
    try {
      out.screenshot = "scratch/e2e-voice-flow-failed.png";
      await page.screenshot({ path: out.screenshot, fullPage: true });
    } catch {}
  } finally {
    try {
      const probe = await page.evaluate(() => window.__probe).catch(() => null);
      if (probe) {
        out.gumCalls = probe.gumCalls;
        out.plays = probe.plays;
        out.speechSynthesisSpeaks = probe.speechSynthesisSpeaks;
        out.ttsPosts = probe.ttsPosts;
        out.ttsPostFailures = probe.ttsPostFailures;
        out.asrPosts = probe.asrPosts;
        out.chatStreams = probe.chatStreams;
        out.probeErrors = probe.errors;
      }
    } catch {}
    if (approveHits.length && !out.approvePosts) out.approvePosts = approveHits;
    await browser.close();
    console.log("REPORT=" + JSON.stringify(out));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
