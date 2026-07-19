import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppId } from "./types";

export interface CreateTerminalOptions {
  id: string;
  /** Shell command line to run; omit for a plain interactive shell. */
  command?: string;
  /** When set together with providerId, injects that provider's env vars. */
  app?: AppId;
  providerId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalOutputEvent {
  id: string;
  /** Base64-encoded raw PTY bytes. */
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode?: number | null;
}

export const terminalApi = {
  async create(options: CreateTerminalOptions): Promise<boolean> {
    return await invoke("workbench_create_terminal", { ...options });
  },

  async write(id: string, data: string): Promise<boolean> {
    return await invoke("workbench_write_terminal", { id, data });
  },

  async resize(id: string, cols: number, rows: number): Promise<boolean> {
    return await invoke("workbench_resize_terminal", { id, cols, rows });
  },

  async close(id: string): Promise<boolean> {
    return await invoke("workbench_close_terminal", { id });
  },

  async list(): Promise<string[]> {
    return await invoke("workbench_list_terminals");
  },

  async onOutput(
    handler: (event: TerminalOutputEvent) => void,
  ): Promise<UnlistenFn> {
    return await listen("workbench-terminal-output", (event) => {
      handler(event.payload as TerminalOutputEvent);
    });
  },

  async onExit(
    handler: (event: TerminalExitEvent) => void,
  ): Promise<UnlistenFn> {
    return await listen("workbench-terminal-exit", (event) => {
      handler(event.payload as TerminalExitEvent);
    });
  },
};

/** Decode a base64 chunk into bytes for xterm's write(Uint8Array). */
export function decodeTerminalChunk(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
