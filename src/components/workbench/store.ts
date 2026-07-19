import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalApi, decodeTerminalChunk } from "@/lib/api";
import type { AppId } from "@/lib/api";

export type WorkbenchAgent =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "shell"
  | "custom";

export type WorkbenchAuthMode = "subscription" | "api";

export interface AddSessionOptions {
  agent: WorkbenchAgent;
  authMode: WorkbenchAuthMode;
  /** Provider profile to inject env vars from (API mode only). */
  app?: AppId;
  providerId?: string;
  providerName?: string;
  /** Custom command line (agent === "custom"). */
  command?: string;
  cwd?: string;
}

export interface WorkbenchSession {
  id: string;
  agent: WorkbenchAgent;
  authMode: WorkbenchAuthMode;
  title: string;
  subtitle?: string;
  cwd?: string;
  status: "running" | "exited";
  exitCode?: number | null;
}

interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  /** Persistent DOM node the terminal renders into; re-parented on remount. */
  container: HTMLDivElement;
  opened: boolean;
  /** Base64 chunks received before the terminal was opened. */
  pending: string[];
}

export const MAX_SESSIONS = 9;

const AGENT_COMMANDS: Partial<Record<WorkbenchAgent, string>> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
};

export const AGENT_LABELS: Record<WorkbenchAgent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  shell: "Shell",
  custom: "Custom",
};

const TERMINAL_THEME = {
  background: "#16161e",
  foreground: "#c8ccd4",
  cursor: "#c8ccd4",
  selectionBackground: "#3b4261",
};

let sessions: WorkbenchSession[] = [];
const handles = new Map<string, TerminalHandle>();
const listeners = new Set<() => void>();
let eventsBound = false;

function emit() {
  for (const listener of listeners) listener();
}

function updateSession(id: string, patch: Partial<WorkbenchSession>) {
  sessions = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emit();
}

async function ensureEventListeners() {
  if (eventsBound) return;
  eventsBound = true;
  await terminalApi.onOutput(({ id, data }) => {
    const handle = handles.get(id);
    if (!handle) return;
    if (handle.opened) {
      handle.term.write(decodeTerminalChunk(data));
    } else {
      handle.pending.push(data);
    }
  });
  await terminalApi.onExit(({ id, exitCode }) => {
    const handle = handles.get(id);
    if (handle) {
      const suffix = exitCode != null ? ` (exit code ${exitCode})` : "";
      const message = `\r\n\x1b[2m[session ended${suffix}]\x1b[0m\r\n`;
      if (handle.opened) {
        handle.term.write(message);
      } else {
        handle.pending.push(btoa(message));
      }
    }
    if (sessions.some((s) => s.id === id)) {
      updateSession(id, { status: "exited", exitCode });
    }
  });
}

export const workbenchStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSessions(): WorkbenchSession[] {
    return sessions;
  },

  getHandle(id: string): TerminalHandle | undefined {
    return handles.get(id);
  },

  async addSession(options: AddSessionOptions): Promise<void> {
    if (sessions.length >= MAX_SESSIONS) {
      throw new Error("workbench is full");
    }
    await ensureEventListeners();

    const id = crypto.randomUUID();
    const command =
      options.agent === "custom"
        ? options.command
        : AGENT_COMMANDS[options.agent];

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', monospace",
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.onData((data) => {
      void terminalApi.write(id, data).catch(() => {});
    });

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";

    handles.set(id, { term, fit, container, opened: false, pending: [] });

    const isApi = options.authMode === "api";
    const session: WorkbenchSession = {
      id,
      agent: options.agent,
      authMode: options.authMode,
      title:
        options.agent === "custom" && options.command
          ? options.command
          : AGENT_LABELS[options.agent],
      subtitle:
        options.agent === "shell" || options.agent === "custom"
          ? undefined
          : isApi
            ? `API${options.providerName ? ` · ${options.providerName}` : ""}`
            : "Subscription",
      cwd: options.cwd,
      status: "running",
    };

    try {
      await terminalApi.create({
        id,
        command,
        app: isApi ? options.app : undefined,
        providerId: isApi ? options.providerId : undefined,
        cwd: options.cwd,
        cols: 80,
        rows: 24,
      });
    } catch (error) {
      handles.delete(id);
      term.dispose();
      throw error;
    }

    sessions = [...sessions, session];
    emit();
  },

  /** Kill the underlying process (session stays visible until removed). */
  async closeSession(id: string): Promise<void> {
    await terminalApi.close(id).catch(() => {});
  },

  /** Kill (if needed) and drop the session tile entirely. */
  async removeSession(id: string): Promise<void> {
    await terminalApi.close(id).catch(() => {});
    const handle = handles.get(id);
    if (handle) {
      handle.term.dispose();
      handle.container.remove();
      handles.delete(id);
    }
    sessions = sessions.filter((s) => s.id !== id);
    emit();
  },

  /** Attach a session's terminal DOM into a host element (on pane mount). */
  attach(id: string, host: HTMLElement) {
    const handle = handles.get(id);
    if (!handle) return;
    host.appendChild(handle.container);
    if (!handle.opened) {
      handle.term.open(handle.container);
      handle.opened = true;
      for (const chunk of handle.pending) {
        handle.term.write(decodeTerminalChunk(chunk));
      }
      handle.pending = [];
    }
    this.fit(id);
  },

  /** Detach the terminal DOM without destroying it (on pane unmount). */
  detach(id: string) {
    const handle = handles.get(id);
    if (handle && handle.container.parentElement) {
      handle.container.parentElement.removeChild(handle.container);
    }
  },

  fit(id: string) {
    const handle = handles.get(id);
    if (!handle || !handle.opened) return;
    try {
      handle.fit.fit();
    } catch {
      return;
    }
    const { cols, rows } = handle.term;
    if (cols > 0 && rows > 0) {
      void terminalApi.resize(id, cols, rows).catch(() => {});
    }
  },

  focus(id: string) {
    handles.get(id)?.term.focus();
  },

  async writeInput(id: string, text: string): Promise<void> {
    const session = sessions.find((item) => item.id === id);
    if (!session || session.status !== "running" || !text) return;
    await terminalApi.write(id, text);
    handles.get(id)?.term.focus();
  },
};
