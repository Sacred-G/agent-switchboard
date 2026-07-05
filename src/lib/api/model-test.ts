import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "./types";

export type HealthStatus = "operational" | "degraded" | "failed";

export interface StreamCheckConfig {
  timeoutSecs: number;

  maxRetries: number;

  degradedThresholdMs: number;
}

export interface StreamCheckResult {
  status: HealthStatus;
  success: boolean;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  testedAt: number;
  retryCount: number;
}

export async function streamCheckProvider(
  appType: AppId,
  providerId: string,
): Promise<StreamCheckResult> {
  return invoke("stream_check_provider", { appType, providerId });
}

export async function streamCheckAllProviders(
  appType: AppId,
  proxyTargetsOnly: boolean = false,
): Promise<Array<[string, StreamCheckResult]>> {
  return invoke("stream_check_all_providers", { appType, proxyTargetsOnly });
}

export async function getStreamCheckConfig(): Promise<StreamCheckConfig> {
  return invoke("get_stream_check_config");
}

export async function saveStreamCheckConfig(
  config: StreamCheckConfig,
): Promise<void> {
  return invoke("save_stream_check_config", { config });
}
