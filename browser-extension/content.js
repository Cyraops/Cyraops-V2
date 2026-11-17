/**
 * The bridge between the CRM page and the extension.
 *
 * The page asks through window.postMessage; this script forwards the request to
 * the background worker, which drives a tab with the DevTools Protocol. Results
 * come back the same way. Nothing here touches page data on its own.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "cyraops-page" || data.type !== "local-browser:run") return;

  const { id, action, url, selector, text } = data;
  chrome.runtime.sendMessage({ type: "run", id, action, url, selector, text }, (response) => {
    window.postMessage(
      {
        source: "cyraops-extension",
        type: "local-browser:result",
        id,
        ok: Boolean(response?.ok),
        data: response?.data,
        error: response?.error,
      },
      window.location.origin
    );
  });
});

const announce = () =>
  window.postMessage({ source: "cyraops-extension", type: "local-browser:ready", version: "0.1.0" }, window.location.origin);

// Announce, and answer a ping: the page may mount after this script runs.
announce();
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source === "cyraops-page" && event.data?.type === "local-browser:ping") announce();
});
