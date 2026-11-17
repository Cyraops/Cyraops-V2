import { useCallback, useEffect, useState } from "react";

/**
 * Path-based router.
 *
 * The site used to be hash-only (`#/catalogue`), which meant a crawler saw one
 * document and every real path returned 404. Routes are now real paths, so each
 * page is its own URL that can be prerendered, canonicalised and indexed.
 *
 * Legacy `#/x` links still work: on load they are rewritten to `/x` so old
 * shares keep resolving instead of landing on the home page.
 *
 *   /                        home
 *   /solutions               axis index
 *   /solutions/llm-studio    offering detail
 */

const ROUTE_EVENT = "cyraops:route";

export function useRoute() {
  const [path, setPath] = useState(() => currentPath());

  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("popstate", onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);

  return path;
}

/** The pathname, with a legacy hash URL promoted to a real one. */
function currentPath(): string {
  const legacy = window.location.hash.replace(/^#/, "");
  if (legacy.startsWith("/")) {
    // An old #/about link: adopt the real path so the address bar, canonical
    // and every link on the page agree with what the crawler would have seen.
    const target = normalise(legacy);
    window.history.replaceState({}, "", target);
    return target;
  }
  return normalise(window.location.pathname);
}

function normalise(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  if (clean === "" || clean === "/") return "/";
  return clean.replace(/\/+$/, "") || "/";
}

/** "/solutions" and "#/solutions" both route to /solutions. */
export function toPath(href: string): string {
  const raw = href.startsWith("#") ? href.slice(1) : href;
  if (!raw.startsWith("/")) return raw;
  return normalise(raw);
}

export function navigate(href: string) {
  const target = toPath(href);
  if (!target.startsWith("/")) return;
  if (normalise(window.location.pathname) === target && !window.location.hash) return;
  window.history.pushState({}, "", target);
  window.dispatchEvent(new Event(ROUTE_EVENT));
  // Detail pages start at the top; in-page anchors are handled by the caller.
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

/** "/solutions/assistant-workspace" -> ["solutions", "assistant-workspace"] */
export function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function useScrollTopOnRouteChange(path: string) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [path]);
}

export function useLinkHandler() {
  return useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    // In-page anchors (on the home page) keep smooth scrolling.
    if (href.startsWith("#") && !href.startsWith("#/")) return;
    if (!toPath(href).startsWith("/")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  }, []);
}
