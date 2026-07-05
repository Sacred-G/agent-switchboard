import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { toast } from "sonner";

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

export async function fetchModelsForConfig(
  baseUrl: string,
  apiKey: string,
  isFullUrl?: boolean,
  modelsUrl?: string,
  customUserAgent?: string,
): Promise<FetchedModel[]> {
  return invoke("fetch_models_for_config", {
    baseUrl,
    apiKey,
    isFullUrl,
    modelsUrl,
    customUserAgent,
  });
}

export async function fetchCodexOauthModels(
  accountId?: string | null,
): Promise<FetchedModel[]> {
  return invoke("get_codex_oauth_models", {
    accountId: accountId || null,
  });
}

export function showFetchModelsError(
  err: unknown,
  t: TFunction,
  opts?: { hasApiKey: boolean; hasBaseUrl: boolean },
): void {
  if (opts && !opts.hasBaseUrl && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedConfig"));
    return;
  }
  if (opts && !opts.hasApiKey) {
    toast.error(t("providerForm.fetchModelsNeedApiKey"));
    return;
  }
  if (opts && !opts.hasBaseUrl) {
    toast.error(t("providerForm.fetchModelsNeedEndpoint"));
    return;
  }

  const msg = String(err);

  if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
    toast.error(t("providerForm.fetchModelsAuthFailed"));
    return;
  }
  if (msg.includes("All candidates failed")) {
    toast.error(t("providerForm.fetchModelsEndpointNotFound"));
    return;
  }
  if (msg.includes("HTTP 404") || msg.includes("HTTP 405")) {
    toast.error(t("providerForm.fetchModelsEndpointNotFound"));
    return;
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    toast.error(t("providerForm.fetchModelsTimeout"));
    return;
  }
  if (msg.includes("Failed to parse")) {
    toast.error(t("providerForm.fetchModelsNotSupported"));
    return;
  }

  toast.error(t("providerForm.fetchModelsFailed"));
}
