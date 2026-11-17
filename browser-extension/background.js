/**
 * Drives one tab with the DevTools Protocol.
 *
 * The tab belongs to the person's own browser profile — their logins, their
 * network, their internal sites — but it is a tab the assistant opens and owns,
 * so the CRM tab the person is working in is never navigated away from.
 */
let targetTabId = null;
const ATTACH = { version: "1.3" };

async function ensureTab(url) {
  if (targetTabId !== null) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab) {
        if (url) await chrome.tabs.update(targetTabId, { url });
        return targetTabId;
      }
    } catch {
      targetTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: url || "about:blank", active: false });
  targetTabId = tab.id;
  return targetTabId;
}

async function attach(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, ATTACH.version);
  } catch (error) {
    // Already attached is fine.
    if (!String(error?.message || "").includes("Another debugger is already attached")) throw error;
  }
}

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params || {});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLoad(tabId, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { result } = await send(tabId, "Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (result?.value === "complete") return true;
    } catch {
      /* keep waiting */
    }
    await sleep(300);
  }
  return false;
}

async function run({ action, url, selector, text }) {
  const tabId = await ensureTab(action === "navigate" ? url : undefined);
  await attach(tabId);

  if (action === "navigate") {
    await send(tabId, "Page.enable");
    await send(tabId, "Page.navigate", { url });
    await waitForLoad(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { ok: true, data: { url: tab.url, title: tab.title } };
  }

  if (action === "click") {
    const { result } = await send(tabId, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      returnByValue: true,
    });
    const point = result?.value;
    if (!point) return { ok: false, error: `Nothing matched ${selector}` };
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send(tabId, "Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    }
    await sleep(600);
    const tab = await chrome.tabs.get(tabId);
    return { ok: true, data: { url: tab.url, title: tab.title } };
  }

  if (action === "type") {
    await send(tabId, "Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)})?.focus()` });
    await send(tabId, "Input.insertText", { text });
    return { ok: true, data: { text } };
  }

  if (action === "extract") {
    const { result } = await send(tabId, "Runtime.evaluate", {
      expression: "document.body ? document.body.innerText.slice(0, 6000) : ''",
      returnByValue: true,
    });
    const tab = await chrome.tabs.get(tabId);
    return { ok: true, data: { text: result?.value || "", url: tab.url, title: tab.title } };
  }

  if (action === "screenshot") {
    const shot = await send(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 70 });
    const tab = await chrome.tabs.get(tabId);
    return {
      ok: true,
      data: { image: `data:image/jpeg;base64,${shot.data}`, url: tab.url, title: tab.title, width: tab.width, height: tab.height },
    };
  }

  return { ok: false, error: `Unknown action ${action}` };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "run") return false;
  run(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
