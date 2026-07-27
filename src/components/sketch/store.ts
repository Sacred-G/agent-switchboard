import { useSyncExternalStore } from "react";

export type SketchMode = "single" | "split";

export interface SketchState {
  mode: SketchMode;
  /** Full HTML document (single mode, or paste target). */
  html: string;
  /** Body markup (split mode). */
  markup: string;
  css: string;
  js: string;
}

const STORAGE_KEY = "agent-switchboard-sketch";

const DEFAULT_SINGLE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sketch</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 2rem; }
    </style>
  </head>
  <body>
    <h1>Hello 👋</h1>
    <p>Edit the HTML on the left and watch it update.</p>
    <script>
      console.log("Sketch loaded");
    </script>
  </body>
</html>
`;

const DEFAULT_MARKUP = `<h1>Hello 👋</h1>
<p>Edit HTML, CSS, and JS on the left.</p>
<button id="go">Click me</button>
`;

const DEFAULT_CSS = `body {
  font-family: system-ui, sans-serif;
  padding: 2rem;
}
button {
  padding: 0.5rem 1rem;
  cursor: pointer;
}
`;

const DEFAULT_JS = `document.getElementById("go")?.addEventListener("click", () => {
  alert("It works!");
});
`;

function loadState(): SketchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SketchState>;
      return {
        mode: parsed.mode === "split" ? "split" : "single",
        html: typeof parsed.html === "string" ? parsed.html : DEFAULT_SINGLE,
        markup:
          typeof parsed.markup === "string" ? parsed.markup : DEFAULT_MARKUP,
        css: typeof parsed.css === "string" ? parsed.css : DEFAULT_CSS,
        js: typeof parsed.js === "string" ? parsed.js : DEFAULT_JS,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return {
    mode: "single",
    html: DEFAULT_SINGLE,
    markup: DEFAULT_MARKUP,
    css: DEFAULT_CSS,
    js: DEFAULT_JS,
  };
}

let state: SketchState = loadState();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable */
  }
}

function setState(patch: Partial<SketchState>) {
  state = { ...state, ...patch };
  persist();
  for (const listener of listeners) listener();
}

/** Compose the final HTML document from whichever mode is active. */
export function composeHtml(input: SketchState = state): string {
  if (input.mode === "single") return input.html;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sketch</title>
    <style>
${input.css}
    </style>
  </head>
  <body>
${input.markup}
    <script>
${input.js}
    </script>
  </body>
</html>
`;
}

export const sketchStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState(): SketchState {
    return state;
  },
  setMode(mode: SketchMode) {
    setState({ mode });
  },
  setHtml(html: string) {
    setState({ html });
  },
  setMarkup(markup: string) {
    setState({ markup });
  },
  setCss(css: string) {
    setState({ css });
  },
  setJs(js: string) {
    setState({ js });
  },
};

export function useSketch(): SketchState {
  return useSyncExternalStore(sketchStore.subscribe, sketchStore.getState);
}
