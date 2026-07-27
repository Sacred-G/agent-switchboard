import { useSyncExternalStore } from "react";

export const MAX_PAGES = 9;

export type WebLayoutPreset =
  | "single"
  | "split-h"
  | "split-v"
  | "grid-2x2"
  | "one-top-row"
  | "grid-3x3";

export interface WebLayoutDef {
  id: WebLayoutPreset;
  /** Maximum panes this layout displays. */
  capacity: number;
}

export const WEB_LAYOUTS: WebLayoutDef[] = [
  { id: "single", capacity: 1 },
  { id: "split-h", capacity: 2 },
  { id: "split-v", capacity: 2 },
  { id: "grid-2x2", capacity: 4 },
  { id: "one-top-row", capacity: 5 },
  { id: "grid-3x3", capacity: 9 },
];

export interface WebPage {
  id: string;
  title: string;
  url: string;
  /** Bumped to force the iframe to reload without changing the URL. */
  reloadNonce: number;
}

export interface WebBoardState {
  pages: WebPage[];
  layout: WebLayoutPreset;
}

const STORAGE_KEY = "agent-switchboard-webboard";

function loadState(): WebBoardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WebBoardState>;
      const pages = Array.isArray(parsed.pages)
        ? parsed.pages.slice(0, MAX_PAGES).map((page) => ({
            id: page.id ?? crypto.randomUUID(),
            title: page.title ?? "",
            url: page.url ?? "",
            reloadNonce: 0,
          }))
        : [];
      const layout =
        parsed.layout && WEB_LAYOUTS.some((l) => l.id === parsed.layout)
          ? parsed.layout
          : "single";
      return { pages, layout };
    }
  } catch {
    /* fall through to default */
  }
  return { pages: [], layout: "single" };
}

let state: WebBoardState = loadState();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pages: state.pages, layout: state.layout }),
    );
  } catch {
    /* storage may be unavailable; keep in-memory state */
  }
}

function setState(next: WebBoardState) {
  state = next;
  persist();
  for (const listener of listeners) listener();
}

/** Prepends https:// when the user omits a scheme, and rejects empty input. */
export function normalizeWebUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:\d+)?(\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function deriveTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const webBoardStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getState(): WebBoardState {
    return state;
  },

  addPage(rawUrl: string): boolean {
    if (state.pages.length >= MAX_PAGES) return false;
    const url = normalizeWebUrl(rawUrl);
    if (!url) return false;
    const page: WebPage = {
      id: crypto.randomUUID(),
      title: deriveTitle(url),
      url,
      reloadNonce: 0,
    };
    setState({ ...state, pages: [...state.pages, page] });
    return true;
  },

  addBlankPage(): boolean {
    if (state.pages.length >= MAX_PAGES) return false;
    const page: WebPage = {
      id: crypto.randomUUID(),
      title: "",
      url: "",
      reloadNonce: 0,
    };
    setState({ ...state, pages: [...state.pages, page] });
    return true;
  },

  setPageUrl(id: string, rawUrl: string) {
    const url = normalizeWebUrl(rawUrl);
    setState({
      ...state,
      pages: state.pages.map((page) =>
        page.id === id
          ? {
              ...page,
              url: url ?? "",
              title: url ? deriveTitle(url) : "",
              reloadNonce: page.reloadNonce + 1,
            }
          : page,
      ),
    });
  },

  reloadPage(id: string) {
    setState({
      ...state,
      pages: state.pages.map((page) =>
        page.id === id ? { ...page, reloadNonce: page.reloadNonce + 1 } : page,
      ),
    });
  },

  removePage(id: string) {
    setState({
      ...state,
      pages: state.pages.filter((page) => page.id !== id),
    });
  },

  movePage(id: string, direction: -1 | 1) {
    const index = state.pages.findIndex((page) => page.id === id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= state.pages.length) return;
    const pages = [...state.pages];
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    setState({ ...state, pages });
  },

  setLayout(layout: WebLayoutPreset) {
    setState({ ...state, layout });
  },
};

export function useWebBoard(): WebBoardState {
  return useSyncExternalStore(webBoardStore.subscribe, webBoardStore.getState);
}
