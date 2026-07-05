import { invoke } from "@tauri-apps/api/core";

export type AppType = "claude" | "codex" | "gemini" | "omo" | "omo_slim";

export async function getClaudeCommonConfigSnippet(): Promise<string | null> {
  return invoke<string | null>("get_claude_common_config_snippet");
}

export async function setClaudeCommonConfigSnippet(
  snippet: string,
): Promise<void> {
  return invoke("set_claude_common_config_snippet", { snippet });
}

export async function getCommonConfigSnippet(
  appType: AppType,
): Promise<string | null> {
  return invoke<string | null>("get_common_config_snippet", { appType });
}

export async function setCommonConfigSnippet(
  appType: AppType,
  snippet: string,
): Promise<void> {
  return invoke("set_common_config_snippet", { appType, snippet });
}

export type ExtractCommonConfigSnippetOptions = {
  settingsConfig?: string;
};

export async function extractCommonConfigSnippet(
  appType: Exclude<AppType, "omo">,
  options?: ExtractCommonConfigSnippetOptions,
): Promise<string> {
  const args: Record<string, unknown> = { appType };
  const settingsConfig = options?.settingsConfig;

  if (typeof settingsConfig === "string" && settingsConfig.trim()) {
    args.settingsConfig = settingsConfig;
  }

  return invoke<string>("extract_common_config_snippet", args);
}
