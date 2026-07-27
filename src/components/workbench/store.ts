import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { sendNotification } from "@tauri-apps/plugin-notification";
import "@xterm/xterm/css/xterm.css";
import { terminalApi, workbenchApi, decodeTerminalChunk } from "@/lib/api";
import type {
  AppId,
  PersistedWorkbenchPanel,
  WorkbenchLayoutPreset,
  WorkbenchPanelView,
  WorkbenchActivity,
  WorkbenchCommandRecord,
  WorkbenchWorkspaceDocument,
  WorkbenchWorkspaceRecord,
} from "@/lib/api";

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
  isolateWithWorktree?: boolean;
  worktreeBranch?: string;
}

export interface WorkbenchSession {
  id: string;
  agent: WorkbenchAgent;
  authMode: WorkbenchAuthMode;
  app?: AppId;
  providerId?: string;
  providerName?: string;
  command?: string;
  title: string;
  subtitle?: string;
  cwd?: string;
  sourceCwd?: string;
  worktreeBranch?: string;
  commandHistory: WorkbenchCommandRecord[];
  notifyOnComplete: boolean;
  activity: WorkbenchActivity;
  status: "running" | "exited";
  exitCode?: number | null;
  /** Local dev-server URLs auto-detected in this session's output, oldest first. */
  detectedUrls: string[];
  /** Currently selected URL for the preview pane (auto-detected or user-entered). */
  previewUrl?: string;
  view: WorkbenchPanelView;
}

export interface WorkbenchState {
  initialized: boolean;
  loading: boolean;
  workspaceId?: string;
  workspaceName: string;
  layout: WorkbenchLayoutPreset;
  focusedPanelId?: string;
  columnRatio: number;
  rowRatio: number;
  recentWorkspaces: WorkbenchWorkspaceRecord[];
}

interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  /** Persistent DOM node the terminal renders into; re-parented on remount. */
  container: HTMLDivElement;
  opened: boolean;
  /** Base64 chunks received before the terminal was opened. */
  pending: string[];
  /** Decodes PTY output for URL-sniffing without disturbing xterm's own writes. */
  urlDecoder: TextDecoder;
  /** Rolling tail of recent output, so a URL split across two chunks is still caught. */
  outputTail: string;
  inputBuffer: string;
  activeCommandId?: string;
  idleTimer?: ReturnType<typeof setTimeout>;
}

// Strips ANSI CSI/OSC escape sequences so regexes see plain text.
// The OSC branch is lazy ([\s\S]*?) so each `ESC ] ... ST` sequence ends at
// its own terminator instead of swallowing everything up to the last one
// (e.g. the visible link text between an OSC-8 hyperlink's open/close pair).
const ANSI_ESCAPE_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, "");
}

// Matches only loopback addresses — kept in sync with the app's CSP
// `frame-src`, which allows framing localhost/127.0.0.1/[::1] and nothing else.
const LOCAL_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>\x00-\x1f]*)?/gi;
const LOCAL_URL_TEST_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i;

export function isLocalPreviewUrl(url: string): boolean {
  return LOCAL_URL_TEST_RE.test(url);
}

export function extractLocalUrls(text: string): string[] {
  const matches = text.match(LOCAL_URL_RE) ?? [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw
      .replace(/[),.;:'"]+$/, "")
      .replace("0.0.0.0", "localhost");
    seen.add(cleaned);
  }
  return [...seen];
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

function createTerminalHandle(id: string, restored = false): TerminalHandle {
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
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";
  const handle: TerminalHandle = {
    term,
    fit,
    container,
    opened: false,
    pending: restored
      ? [
          btoa(
            "\r\n\x1b[2m[workspace restored - session is stopped; relaunch to continue]\x1b[0m\r\n",
          ),
        ]
      : [],
    urlDecoder: new TextDecoder(),
    outputTail: "",
    inputBuffer: "",
  };
  term.onData((data) => {
    const session = sessions.find((item) => item.id === id);
    if (session?.status === "running") {
      if (session.agent === "shell" && data === "\r") {
        const command = handle.inputBuffer.trim();
        handle.inputBuffer = "";
        if (!command) {
          void terminalApi.write(id, data).catch(() => {});
          return;
        }
        startCommandRecord(id, command, handle);
        const suffix =
          "; __as_exit=$?; printf '\\033]633;D;%s\\a' \"$__as_exit\"\r";
        void terminalApi.write(id, suffix).catch(() => {});
        return;
      }
      if (session.agent === "shell") {
        if (data === "\x03" || data === "\x15") {
          handle.inputBuffer = "";
        } else if (data === "\x7f") {
          handle.inputBuffer = handle.inputBuffer.slice(0, -1);
        } else if (!data.startsWith("\x1b") && data >= " ") {
          handle.inputBuffer += data;
        }
      }
      void terminalApi.write(id, data).catch(() => {});
    }
  });
  return handle;
}

function disposeAllHandles() {
  for (const handle of handles.values()) {
    if (handle.idleTimer) clearTimeout(handle.idleTimer);
    handle.term.dispose();
    handle.container.remove();
  }
  handles.clear();
}

function restoreRecord(record: WorkbenchWorkspaceRecord) {
  disposeAllHandles();
  const document = record.document;
  sessions = [...document.panels]
    .sort((left, right) => left.order - right.order)
    .slice(0, MAX_SESSIONS)
    .map((panel) => {
      const session: WorkbenchSession = {
        id: panel.id,
        agent: panel.agent,
        authMode: panel.authMode,
        title: panel.title,
        status: "exited",
        detectedUrls: panel.detectedUrls ?? [],
        view: panel.view ?? "terminal",
        ...(panel.app ? { app: panel.app as AppId } : {}),
        ...(panel.providerId ? { providerId: panel.providerId } : {}),
        ...(panel.providerName ? { providerName: panel.providerName } : {}),
        ...(panel.command ? { command: panel.command } : {}),
        ...(panel.subtitle ? { subtitle: panel.subtitle } : {}),
        ...(panel.cwd ? { cwd: panel.cwd } : {}),
        ...(panel.sourceCwd ? { sourceCwd: panel.sourceCwd } : {}),
        ...(panel.worktreeBranch
          ? { worktreeBranch: panel.worktreeBranch }
          : {}),
        commandHistory: panel.commandHistory ?? [],
        notifyOnComplete: panel.notifyOnComplete ?? false,
        activity: "complete",
        ...(panel.previewUrl ? { previewUrl: panel.previewUrl } : {}),
      };
      handles.set(session.id, createTerminalHandle(session.id, true));
      return session;
    });
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, record.id);
  const restoredLayout = document.layout ?? "dashboard";
  const layout =
    (restoredLayout === "side-by-side" && sessions.length > 2) ||
    (restoredLayout === "grid-2x2" && sessions.length > 4)
      ? "dashboard"
      : restoredLayout;
  state = {
    ...state,
    initialized: true,
    loading: false,
    workspaceId: record.id,
    workspaceName: record.name,
    layout,
    focusedPanelId: document.focusedPanelId,
    columnRatio: document.columnRatio ?? 50,
    rowRatio: document.rowRatio ?? 50,
  };
  emit();
}

let sessions: WorkbenchSession[] = [];
const handles = new Map<string, TerminalHandle>();
const listeners = new Set<() => void>();
let eventsBound = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveSequence: Promise<void> = Promise.resolve();
const ACTIVE_WORKSPACE_KEY = "agent-switchboard-active-workbench";
const DEFAULT_WORKSPACE_NAME = "My workspace";
let state: WorkbenchState = {
  initialized: false,
  loading: false,
  workspaceName: DEFAULT_WORKSPACE_NAME,
  layout: "dashboard",
  columnRatio: 50,
  rowRatio: 50,
  recentWorkspaces: [],
};

function emit() {
  for (const listener of listeners) listener();
}

function updateState(patch: Partial<WorkbenchState>) {
  state = { ...state, ...patch };
  emit();
}

function toDocument(): WorkbenchWorkspaceDocument {
  return {
    schemaVersion: 1,
    layout: state.layout,
    focusedPanelId: state.focusedPanelId,
    columnRatio: state.columnRatio,
    rowRatio: state.rowRatio,
    panels: sessions.map(
      (session, order): PersistedWorkbenchPanel => ({
        id: session.id,
        agent: session.agent,
        authMode: session.authMode,
        app: session.app,
        providerId: session.providerId,
        providerName: session.providerName,
        command: session.command,
        title: session.title,
        subtitle: session.subtitle,
        cwd: session.cwd,
        sourceCwd: session.sourceCwd,
        worktreeBranch: session.worktreeBranch,
        commandHistory: session.commandHistory.map((record) => ({
          ...record,
          output: record.pinned ? record.output.slice(-8_000) : "",
        })),
        notifyOnComplete: session.notifyOnComplete,
        previewUrl: session.previewUrl,
        detectedUrls: session.detectedUrls,
        view: session.view,
        order,
      }),
    ),
  };
}

function copyPanelForNewWorkspace(
  panel: PersistedWorkbenchPanel,
  order: number,
): PersistedWorkbenchPanel {
  const copy = {
    ...panel,
    id: crypto.randomUUID(),
    order,
    cwd: panel.sourceCwd ?? panel.cwd,
    commandHistory: [],
    notifyOnComplete: false,
  };
  delete copy.sourceCwd;
  delete copy.worktreeBranch;
  return copy;
}

async function saveCurrentWorkspace(opened = false) {
  if (!state.initialized || !state.workspaceId) return;
  const workspaceId = state.workspaceId;
  const workspaceName = state.workspaceName;
  const document = toDocument();
  const operation = saveSequence
    .catch(() => {})
    .then(() =>
      workbenchApi.save(workspaceId, workspaceName, document, opened),
    );
  saveSequence = operation.then(
    () => undefined,
    () => undefined,
  );
  const saved = await operation;
  state = {
    ...state,
    recentWorkspaces: [
      saved,
      ...state.recentWorkspaces.filter((item) => item.id !== saved.id),
    ],
  };
  emit();
}

function scheduleSave() {
  if (!state.initialized || !state.workspaceId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveCurrentWorkspace().catch((error) => {
      console.error("failed to save workbench workspace", error);
    });
  }, 250);
}

function updateSession(id: string, patch: Partial<WorkbenchSession>) {
  sessions = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emit();
  scheduleSave();
}

const COMMAND_OUTPUT_LIMIT = 8_000;
const COMMAND_HISTORY_LIMIT = 50;
const COMMAND_END_RE = /\x1b\]633;D;(\d+)(?:\x07|\x1b\\)/g;
const WAITING_RE =
  /(?:press enter|continue\?|waiting for|approve|allow this|confirm|\[y\/n\]|password:)/i;

export function detectCommandFailureHint(output: string): string | undefined {
  if (/EADDRINUSE|address already in use/i.test(output)) {
    return "A port is already in use. Stop the existing server or choose another port.";
  }
  if (/command not found|is not recognized as an internal/i.test(output)) {
    return "The command is unavailable. Check that the tool is installed and on PATH.";
  }
  if (/permission denied|EACCES/i.test(output)) {
    return "The command was denied access. Check file ownership and permissions.";
  }
  if (/ENOENT|no such file or directory/i.test(output)) {
    return "A required file or directory was not found. Check the working directory and paths.";
  }
  return undefined;
}

export function detectCommandQuickFix(output: string): string | undefined {
  const ports = /EADDRINUSE|address already in use/i.test(output)
    ? [...output.matchAll(/:(\d{2,5})\b/g)]
    : [];
  const port =
    ports[ports.length - 1]?.[1] ?? output.match(/port\s+(\d{2,5})/i)?.[1];
  if (port) return `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  if (/permission denied|EACCES/i.test(output)) return "pwd && ls -la";
  if (/ENOENT|no such file or directory/i.test(output)) return "pwd && ls";
  return undefined;
}

function replaceRuntimeSession(id: string, patch: Partial<WorkbenchSession>) {
  sessions = sessions.map((session) =>
    session.id === id ? { ...session, ...patch } : session,
  );
  emit();
}

function startCommandRecord(
  id: string,
  command: string,
  handle: TerminalHandle,
) {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  const record: WorkbenchCommandRecord = {
    id: crypto.randomUUID(),
    command,
    startedAt: Date.now(),
    output: "",
    terminalLine:
      handle.term.buffer.active.baseY + handle.term.buffer.active.cursorY,
  };
  handle.activeCommandId = record.id;
  replaceRuntimeSession(id, {
    commandHistory: [...session.commandHistory, record].slice(
      -COMMAND_HISTORY_LIMIT,
    ),
    activity: "working",
  });
}

function finishCommandRecord(
  id: string,
  handle: TerminalHandle,
  exitCode: number | null | undefined,
) {
  if (!handle.activeCommandId) return;
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  const endedAt = Date.now();
  const history = session.commandHistory.map((record) =>
    record.id === handle.activeCommandId
      ? {
          ...record,
          endedAt,
          exitCode,
          failureHint:
            exitCode && exitCode !== 0
              ? detectCommandFailureHint(record.output)
              : undefined,
          quickFixCommand:
            exitCode && exitCode !== 0
              ? detectCommandQuickFix(record.output)
              : undefined,
        }
      : record,
  );
  handle.activeCommandId = undefined;
  updateSession(id, {
    commandHistory: history,
    activity: exitCode === 0 ? "complete" : "failed",
  });
  const finished = history[history.length - 1];
  if (
    session.notifyOnComplete &&
    finished &&
    endedAt - finished.startedAt >= 10_000
  ) {
    sendNotification({
      title: session.title,
      body:
        exitCode === 0
          ? `Completed: ${finished.command}`
          : `Failed (${exitCode ?? "unknown"}): ${finished.command}`,
    });
  }
}

function recordTerminalOutput(
  id: string,
  handle: TerminalHandle,
  text: string,
) {
  const session = sessions.find((item) => item.id === id);
  if (!session) return;
  let history = session.commandHistory;
  if (handle.activeCommandId) {
    const clean = stripAnsi(text.replace(COMMAND_END_RE, ""));
    history = history.map((record) =>
      record.id === handle.activeCommandId
        ? {
            ...record,
            output: (record.output + clean).slice(-COMMAND_OUTPUT_LIMIT),
          }
        : record,
    );
  }
  const waitingForInput = WAITING_RE.test(stripAnsi(text));
  if (
    waitingForInput &&
    session.activity !== "waiting" &&
    session.notifyOnComplete
  ) {
    sendNotification({
      title: session.title,
      body: "This panel needs your input.",
    });
  }
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  replaceRuntimeSession(id, {
    commandHistory: history,
    activity: waitingForInput ? "waiting" : "working",
  });
  handle.idleTimer = setTimeout(() => {
    const current = sessions.find((item) => item.id === id);
    if (current?.status === "running" && current.activity === "working") {
      replaceRuntimeSession(id, { activity: "waiting" });
    }
  }, 2500);
  for (const match of text.matchAll(COMMAND_END_RE)) {
    finishCommandRecord(id, handle, Number(match[1]));
  }
}

const MAX_DETECTED_URLS = 5;
// Keep enough tail to reassemble a URL split across two small PTY chunks,
// without letting the buffer grow unbounded on chatty processes.
const OUTPUT_TAIL_LIMIT = 4096;

function detectAndRecordUrls(id: string, handle: TerminalHandle, text: string) {
  const combined = stripAnsi(handle.outputTail + text);
  handle.outputTail = combined.slice(-OUTPUT_TAIL_LIMIT);

  const found = extractLocalUrls(combined);
  if (found.length === 0) return;

  const session = sessions.find((item) => item.id === id);
  if (!session) return;

  const merged = [...session.detectedUrls];
  let changed = false;
  for (const url of found) {
    if (!merged.includes(url)) {
      merged.push(url);
      changed = true;
    }
  }
  if (!changed) return;
  while (merged.length > MAX_DETECTED_URLS) merged.shift();

  updateSession(id, {
    detectedUrls: merged,
    previewUrl: session.previewUrl ?? merged[merged.length - 1],
  });
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
    let text = "";
    try {
      text = handle.urlDecoder.decode(decodeTerminalChunk(data), {
        stream: true,
      });
    } catch {
      // xterm still receives the raw bytes even when metadata decoding fails.
    }
    detectAndRecordUrls(id, handle, text);
    recordTerminalOutput(id, handle, text);
  });
  await terminalApi.onExit(({ id, exitCode }) => {
    const handle = handles.get(id);
    if (handle) {
      if (handle.idleTimer) clearTimeout(handle.idleTimer);
      const suffix = exitCode != null ? ` (exit code ${exitCode})` : "";
      const message = `\r\n\x1b[2m[session ended${suffix}]\x1b[0m\r\n`;
      if (handle.opened) {
        handle.term.write(message);
      } else {
        handle.pending.push(btoa(message));
      }
    }
    if (sessions.some((s) => s.id === id)) {
      if (handle) finishCommandRecord(id, handle, exitCode);
      updateSession(id, {
        status: "exited",
        exitCode,
        activity: exitCode === 0 ? "complete" : "failed",
      });
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

  getState(): WorkbenchState {
    return state;
  },

  async initialize(): Promise<void> {
    if (state.initialized || state.loading) return;
    updateState({ loading: true });
    await ensureEventListeners();
    try {
      const recentWorkspaces = await workbenchApi.list();
      state = { ...state, recentWorkspaces };
      const activeId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      const selected =
        recentWorkspaces.find((workspace) => workspace.id === activeId) ??
        recentWorkspaces[0];
      if (selected) {
        restoreRecord(selected);
        await workbenchApi.touch(selected.id);
        return;
      }

      const id = crypto.randomUUID();
      state = {
        ...state,
        initialized: true,
        loading: false,
        workspaceId: id,
        workspaceName: DEFAULT_WORKSPACE_NAME,
      };
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
      await saveCurrentWorkspace(true);
    } catch (error) {
      updateState({ loading: false });
      throw error;
    }
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

    let launchCwd = options.cwd;
    let sourceCwd: string | undefined;
    let worktreeBranch: string | undefined;
    if (options.isolateWithWorktree) {
      if (!options.cwd || !state.workspaceId) {
        throw new Error("a saved workspace and Git repository are required");
      }
      const worktree = await workbenchApi.createWorktree({
        repository: options.cwd,
        workspaceId: state.workspaceId,
        panelId: id,
        ...(options.worktreeBranch ? { branch: options.worktreeBranch } : {}),
      });
      launchCwd = worktree.path;
      sourceCwd = worktree.repositoryRoot;
      worktreeBranch = worktree.branch;
    }

    const handle = createTerminalHandle(id);
    handles.set(id, handle);

    const isApi = options.authMode === "api";
    const session: WorkbenchSession = {
      id,
      agent: options.agent,
      authMode: options.authMode,
      ...(options.app ? { app: options.app } : {}),
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(options.providerName ? { providerName: options.providerName } : {}),
      ...(command ? { command } : {}),
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
      cwd: launchCwd,
      ...(sourceCwd ? { sourceCwd } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
      commandHistory: [],
      notifyOnComplete: false,
      activity: "working",
      detectedUrls: [],
      status: "running",
      view: "terminal",
    };

    try {
      await terminalApi.create({
        id,
        command,
        app: isApi ? options.app : undefined,
        providerId: isApi ? options.providerId : undefined,
        cwd: launchCwd,
        cols: 80,
        rows: 24,
      });
    } catch (error) {
      handles.delete(id);
      handle.term.dispose();
      throw error;
    }

    sessions = [...sessions, session];
    if (command) startCommandRecord(id, command, handle);
    emit();
    scheduleSave();
  },

  /** Kill the underlying process (session stays visible until removed). */
  async closeSession(id: string): Promise<void> {
    await terminalApi.close(id).catch(() => {});
  },

  async relaunchSession(id: string): Promise<void> {
    const session = sessions.find((item) => item.id === id);
    if (!session || session.status === "running") return;
    await ensureEventListeners();
    await terminalApi.create({
      id,
      command: session.command,
      app: session.authMode === "api" ? session.app : undefined,
      providerId: session.authMode === "api" ? session.providerId : undefined,
      cwd: session.cwd,
      cols: 80,
      rows: 24,
    });
    const handle = handles.get(id);
    if (session.command && handle) {
      startCommandRecord(id, session.command, handle);
    }
    handle?.term.write(
      "\r\n\x1b[2m[session relaunched from saved workspace]\x1b[0m\r\n",
    );
    updateSession(id, {
      status: "running",
      exitCode: undefined,
      activity: "working",
    });
    this.fit(id);
    this.focus(id);
  },

  /** Kill (if needed) and drop the session tile entirely. */
  async removeSession(id: string): Promise<void> {
    await terminalApi.close(id).catch(() => {});
    const session = sessions.find((item) => item.id === id);
    if (session?.sourceCwd && session.cwd) {
      await workbenchApi.removeWorktree(session.sourceCwd, session.cwd);
    }
    const handle = handles.get(id);
    if (handle) {
      if (handle.idleTimer) clearTimeout(handle.idleTimer);
      handle.term.dispose();
      handle.container.remove();
      handles.delete(id);
    }
    sessions = sessions.filter((s) => s.id !== id);
    emit();
    scheduleSave();
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

  /**
   * Broadcast the same input to several running panels at once. `submit`
   * appends a carriage return so each panel actually executes it.
   */
  async broadcastInput(
    ids: string[],
    text: string,
    submit = false,
  ): Promise<number> {
    if (!text.trim()) return 0;
    const payload = submit ? `${text}\r` : text;
    let delivered = 0;
    await Promise.all(
      ids.map(async (id) => {
        const session = sessions.find((item) => item.id === id);
        if (!session || session.status !== "running") return;
        try {
          await terminalApi.write(id, payload);
          delivered += 1;
        } catch {
          /* a dead PTY shouldn't abort the rest of the broadcast */
        }
      }),
    );
    return delivered;
  },

  /**
   * Recent plaintext output for a panel — the active command's captured
   * output if one is running, otherwise the most recent finished command,
   * else a scrape of the visible terminal buffer. Used to reference one
   * panel's result inside another panel's prompt.
   */
  getRecentOutput(id: string, maxChars = 4000): string {
    const session = sessions.find((item) => item.id === id);
    if (!session) return "";
    const fromHistory = [...session.commandHistory]
      .reverse()
      .find((record) => record.output.trim().length > 0);
    if (fromHistory) return fromHistory.output.trim().slice(-maxChars);

    const handle = handles.get(id);
    if (!handle) return "";
    const buffer = handle.term.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.length - 200);
    for (let row = start; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(-maxChars);
  },

  /** Set (or clear, with undefined) the preview pane's URL for a session. */
  setPreviewUrl(id: string, url: string | undefined) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    updateSession(id, { previewUrl: url });
  },

  setPanelView(id: string, view: WorkbenchPanelView) {
    updateSession(id, { view });
  },

  setNotifyOnComplete(id: string, enabled: boolean) {
    updateSession(id, { notifyOnComplete: enabled });
  },

  togglePinnedCommand(id: string, recordId: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    const target = session.commandHistory.find(
      (record) => record.id === recordId,
    );
    const pinning = !target?.pinned;
    let pinnedSeen = 0;
    const reversed = [...session.commandHistory].reverse().map((record) => {
      const next =
        record.id === recordId ? { ...record, pinned: pinning } : record;
      if (next.pinned) {
        pinnedSeen += 1;
        if (pinnedSeen > 5) return { ...next, pinned: false };
      }
      return next;
    });
    updateSession(id, { commandHistory: reversed.reverse() });
  },

  searchTerminal(id: string, query: string): number {
    const handle = handles.get(id);
    const needle = query.trim().toLocaleLowerCase();
    if (!handle || !needle) return 0;
    const buffer = handle.term.buffer.active;
    let first: { row: number; column: number; length: number } | undefined;
    let count = 0;
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row)?.translateToString(true) ?? "";
      let from = 0;
      let column = line.toLocaleLowerCase().indexOf(needle, from);
      while (column >= 0) {
        count += 1;
        first ??= { row, column, length: query.length };
        from = column + Math.max(1, query.length);
        column = line.toLocaleLowerCase().indexOf(needle, from);
      }
    }
    if (first) {
      handle.term.select(first.column, first.row, first.length);
      handle.term.scrollToLine(first.row);
    }
    return count;
  },

  jumpToCommand(id: string, recordId: string) {
    const session = sessions.find((item) => item.id === id);
    const record = session?.commandHistory.find((item) => item.id === recordId);
    const handle = handles.get(id);
    if (!handle || record?.terminalLine == null) return;
    handle.term.scrollToLine(record.terminalLine);
    this.focus(id);
  },

  async rerunCommand(id: string, recordId: string): Promise<void> {
    const session = sessions.find((item) => item.id === id);
    const record = session?.commandHistory.find((item) => item.id === recordId);
    if (!session || !record) return;
    if (session.agent === "shell" && session.status === "running") {
      const handle = handles.get(id);
      if (!handle) return;
      startCommandRecord(id, record.command, handle);
      const escaped = record.command.replace(/\r?\n/g, " ");
      const line = `${escaped}; __as_exit=$?; printf '\\033]633;D;%s\\a' \"$__as_exit\"\r`;
      await terminalApi.write(id, line);
      return;
    }
    if (session.status === "exited" && record.command === session.command) {
      await this.relaunchSession(id);
      return;
    }
    throw new Error("stop this panel before rerunning its launch command");
  },

  async runQuickFix(id: string, recordId: string): Promise<"ran" | "copied"> {
    const session = sessions.find((item) => item.id === id);
    const record = session?.commandHistory.find((item) => item.id === recordId);
    if (!session || !record?.quickFixCommand) return "copied";
    if (session.agent === "shell" && session.status === "running") {
      const handle = handles.get(id);
      if (!handle) return "copied";
      startCommandRecord(id, record.quickFixCommand, handle);
      await terminalApi.write(
        id,
        `${record.quickFixCommand}; __as_exit=$?; printf '\\033]633;D;%s\\a' \"$__as_exit\"\r`,
      );
      return "ran";
    }
    await navigator.clipboard.writeText(record.quickFixCommand);
    return "copied";
  },

  reorderSession(activeId: string, overId: string) {
    const from = sessions.findIndex((session) => session.id === activeId);
    const to = sessions.findIndex((session) => session.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...sessions];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    sessions = next;
    emit();
    scheduleSave();
  },

  setFocusedPanel(id: string | undefined) {
    updateState({
      focusedPanelId: id,
      ...(id === undefined && state.layout === "single"
        ? { layout: "dashboard" as const }
        : {}),
    });
    scheduleSave();
  },

  setLayout(layout: WorkbenchLayoutPreset) {
    if (
      (layout === "side-by-side" && sessions.length > 2) ||
      (layout === "grid-2x2" && sessions.length > 4)
    ) {
      return;
    }
    updateState({
      layout,
      focusedPanelId:
        layout === "single"
          ? (state.focusedPanelId ?? sessions[0]?.id)
          : undefined,
    });
    scheduleSave();
  },

  setLayoutRatios(ratios: { columnRatio?: number; rowRatio?: number }) {
    const clamp = (value: number) => Math.min(75, Math.max(25, value));
    updateState({
      ...(ratios.columnRatio != null
        ? { columnRatio: clamp(ratios.columnRatio) }
        : {}),
      ...(ratios.rowRatio != null ? { rowRatio: clamp(ratios.rowRatio) } : {}),
    });
    scheduleSave();
  },

  async renameWorkspace(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("workspace name cannot be empty");
    updateState({ workspaceName: trimmed });
    await saveCurrentWorkspace();
  },

  hasRunningSessions(): boolean {
    return sessions.some((session) => session.status === "running");
  },

  async createWorkspace(name = "Untitled workspace"): Promise<void> {
    if (this.hasRunningSessions()) {
      throw new Error("stop running sessions before switching workspaces");
    }
    await this.flush();
    const id = crypto.randomUUID();
    const document: WorkbenchWorkspaceDocument = {
      schemaVersion: 1,
      layout: "dashboard",
      panels: [],
    };
    const record = await workbenchApi.save(id, name, document, true);
    state = {
      ...state,
      recentWorkspaces: [record, ...state.recentWorkspaces],
    };
    restoreRecord(record);
  },

  async openWorkspace(id: string): Promise<void> {
    if (id === state.workspaceId) return;
    if (this.hasRunningSessions()) {
      throw new Error("stop running sessions before switching workspaces");
    }
    await this.flush();
    const record = await workbenchApi.get(id);
    if (!record) throw new Error("workspace not found");
    restoreRecord(record);
    await workbenchApi.touch(id);
  },

  async duplicateWorkspace(): Promise<void> {
    if (this.hasRunningSessions()) {
      throw new Error("stop running sessions before switching workspaces");
    }
    await this.flush();
    const document = toDocument();
    document.panels = document.panels.map(copyPanelForNewWorkspace);
    delete document.focusedPanelId;
    const record = await workbenchApi.save(
      crypto.randomUUID(),
      `${state.workspaceName} copy`,
      document,
      true,
    );
    state = {
      ...state,
      recentWorkspaces: [record, ...state.recentWorkspaces],
    };
    restoreRecord(record);
  },

  async exportWorkspace(path: string): Promise<void> {
    await this.flush();
    await workbenchApi.export(path, state.workspaceName, toDocument());
  },

  async importWorkspace(path: string): Promise<void> {
    if (this.hasRunningSessions()) {
      throw new Error("stop running sessions before switching workspaces");
    }
    await this.flush();
    const imported = await workbenchApi.import(path);
    const document: WorkbenchWorkspaceDocument = {
      ...imported.document,
      panels: imported.document.panels.map(copyPanelForNewWorkspace),
    };
    delete document.focusedPanelId;
    const record = await workbenchApi.save(
      crypto.randomUUID(),
      imported.name,
      document,
      true,
    );
    state = {
      ...state,
      recentWorkspaces: [record, ...state.recentWorkspaces],
    };
    restoreRecord(record);
  },

  async flush(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    await saveCurrentWorkspace();
  },
};
