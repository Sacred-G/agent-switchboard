import { invoke } from "@tauri-apps/api/core";

export interface CopilotDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubAccount {
  id: string;

  login: string;

  avatar_url: string | null;

  authenticated_at: number;

  github_domain: string;
}

export interface CopilotAuthStatus {
  authenticated: boolean;

  default_account_id: string | null;

  migration_error?: string | null;

  username: string | null;

  expires_at: number | null;

  accounts: GitHubAccount[];
}

export async function copilotStartDeviceFlow(): Promise<CopilotDeviceCodeResponse> {
  return invoke<CopilotDeviceCodeResponse>("copilot_start_device_flow");
}

export async function copilotPollForAuth(deviceCode: string): Promise<boolean> {
  return invoke<boolean>("copilot_poll_for_auth", {
    deviceCode,
  });
}

export async function copilotGetAuthStatus(): Promise<CopilotAuthStatus> {
  return invoke<CopilotAuthStatus>("copilot_get_auth_status");
}

export async function copilotLogout(): Promise<void> {
  return invoke("copilot_logout");
}

export async function copilotIsAuthenticated(): Promise<boolean> {
  return invoke<boolean>("copilot_is_authenticated");
}

export interface CopilotModel {
  id: string;
  name: string;
  vendor: string;
  model_picker_enabled: boolean;
}

export async function copilotGetToken(): Promise<string> {
  return invoke<string>("copilot_get_token");
}

export async function copilotGetModels(): Promise<CopilotModel[]> {
  return invoke<CopilotModel[]>("copilot_get_models");
}

export interface QuotaDetail {
  entitlement: number;
  remaining: number;
  percent_remaining: number;
  unlimited: boolean;
}

export interface QuotaSnapshots {
  chat: QuotaDetail;
  completions: QuotaDetail;
  premium_interactions: QuotaDetail;
}

export interface CopilotUsageResponse {
  copilot_plan: string;
  quota_reset_date: string;
  quota_snapshots: QuotaSnapshots;
}

export async function copilotGetUsage(): Promise<CopilotUsageResponse> {
  return invoke<CopilotUsageResponse>("copilot_get_usage");
}

export async function copilotListAccounts(): Promise<GitHubAccount[]> {
  return invoke<GitHubAccount[]>("copilot_list_accounts");
}

export async function copilotPollForAccount(
  deviceCode: string,
): Promise<GitHubAccount | null> {
  return invoke<GitHubAccount | null>("copilot_poll_for_account", {
    deviceCode,
  });
}

export async function copilotRemoveAccount(accountId: string): Promise<void> {
  return invoke("copilot_remove_account", { accountId });
}

export async function copilotSetDefaultAccount(
  accountId: string,
): Promise<void> {
  return invoke("copilot_set_default_account", { accountId });
}

export async function copilotGetTokenForAccount(
  accountId: string,
): Promise<string> {
  return invoke<string>("copilot_get_token_for_account", { accountId });
}

export async function copilotGetModelsForAccount(
  accountId: string,
): Promise<CopilotModel[]> {
  return invoke<CopilotModel[]>("copilot_get_models_for_account", {
    accountId,
  });
}

export async function copilotGetUsageForAccount(
  accountId: string,
): Promise<CopilotUsageResponse> {
  return invoke<CopilotUsageResponse>("copilot_get_usage_for_account", {
    accountId,
  });
}
