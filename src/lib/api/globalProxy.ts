import { invoke } from "@tauri-apps/api/core";

export interface ProxyTestResult {
  success: boolean;
  latencyMs: number;
  error: string | null;
}

export interface UpstreamProxyStatus {
  enabled: boolean;
  proxyUrl: string | null;
}

export interface DetectedProxy {
  url: string;
  proxyType: string;
  port: number;
}

export async function getGlobalProxyUrl(): Promise<string | null> {
  return invoke<string | null>("get_global_proxy_url");
}

export async function setGlobalProxyUrl(url: string): Promise<void> {
  try {
    return await invoke("set_global_proxy_url", { url });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : String(error));
  }
}

export async function testProxyUrl(url: string): Promise<ProxyTestResult> {
  return invoke<ProxyTestResult>("test_proxy_url", { url });
}

export async function getUpstreamProxyStatus(): Promise<UpstreamProxyStatus> {
  return invoke<UpstreamProxyStatus>("get_upstream_proxy_status");
}

export async function scanLocalProxies(): Promise<DetectedProxy[]> {
  return invoke<DetectedProxy[]>("scan_local_proxies");
}
