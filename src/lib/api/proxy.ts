import { invoke } from "@tauri-apps/api/core";
import type {
  ProxyConfig,
  ProxyStatus,
  ProxyServerInfo,
  ProxyTakeoverStatus,
  GlobalProxyConfig,
  AppProxyConfig,
} from "@/types/proxy";

export const proxyApi = {
  async startProxyServer(): Promise<ProxyServerInfo> {
    return invoke("start_proxy_server");
  },

  async stopProxyWithRestore(): Promise<void> {
    return invoke("stop_proxy_with_restore");
  },

  async getProxyStatus(): Promise<ProxyStatus> {
    return invoke("get_proxy_status");
  },

  async isProxyRunning(): Promise<boolean> {
    return invoke("is_proxy_running");
  },

  async isLiveTakeoverActive(): Promise<boolean> {
    return invoke("is_live_takeover_active");
  },

  async switchProxyProvider(
    appType: string,
    providerId: string,
  ): Promise<void> {
    return invoke("switch_proxy_provider", { appType, providerId });
  },

  async getProxyTakeoverStatus(): Promise<ProxyTakeoverStatus> {
    return invoke("get_proxy_takeover_status");
  },

  async setProxyTakeoverForApp(
    appType: string,
    enabled: boolean,
  ): Promise<void> {
    return invoke("set_proxy_takeover_for_app", { appType, enabled });
  },

  async getProxyConfig(): Promise<ProxyConfig> {
    return invoke("get_proxy_config");
  },

  async updateProxyConfig(config: ProxyConfig): Promise<void> {
    return invoke("update_proxy_config", { config });
  },

  async getGlobalProxyConfig(): Promise<GlobalProxyConfig> {
    return invoke("get_global_proxy_config");
  },

  async updateGlobalProxyConfig(config: GlobalProxyConfig): Promise<void> {
    return invoke("update_global_proxy_config", { config });
  },

  async getProxyConfigForApp(appType: string): Promise<AppProxyConfig> {
    return invoke("get_proxy_config_for_app", { appType });
  },

  async updateProxyConfigForApp(config: AppProxyConfig): Promise<void> {
    return invoke("update_proxy_config_for_app", { config });
  },

  async getDefaultCostMultiplier(appType: string): Promise<string> {
    return invoke("get_default_cost_multiplier", { appType });
  },

  async setDefaultCostMultiplier(
    appType: string,
    value: string,
  ): Promise<void> {
    return invoke("set_default_cost_multiplier", { appType, value });
  },

  async getPricingModelSource(appType: string): Promise<string> {
    return invoke("get_pricing_model_source", { appType });
  },

  async setPricingModelSource(appType: string, value: string): Promise<void> {
    return invoke("set_pricing_model_source", { appType, value });
  },
};
