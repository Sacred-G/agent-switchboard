import { invoke } from "@tauri-apps/api/core";
import type {
  ProviderHealth,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  FailoverQueueItem,
} from "@/types/proxy";

export interface Provider {
  id: string;
  name: string;
  settingsConfig: unknown;
  websiteUrl?: string;
  category?: string;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  meta?: unknown;
  icon?: string;
  iconColor?: string;
}

export const failoverApi = {
  async getProviderHealth(
    providerId: string,
    appType: string,
  ): Promise<ProviderHealth> {
    return invoke("get_provider_health", { providerId, appType });
  },

  async resetCircuitBreaker(
    providerId: string,
    appType: string,
  ): Promise<void> {
    return invoke("reset_circuit_breaker", { providerId, appType });
  },

  async getCircuitBreakerConfig(): Promise<CircuitBreakerConfig> {
    return invoke("get_circuit_breaker_config");
  },

  async updateCircuitBreakerConfig(
    config: CircuitBreakerConfig,
  ): Promise<void> {
    return invoke("update_circuit_breaker_config", { config });
  },

  async getCircuitBreakerStats(
    providerId: string,
    appType: string,
  ): Promise<CircuitBreakerStats | null> {
    return invoke("get_circuit_breaker_stats", { providerId, appType });
  },

  async getFailoverQueue(appType: string): Promise<FailoverQueueItem[]> {
    return invoke("get_failover_queue", { appType });
  },

  async getAvailableProvidersForFailover(appType: string): Promise<Provider[]> {
    return invoke("get_available_providers_for_failover", { appType });
  },

  async addToFailoverQueue(appType: string, providerId: string): Promise<void> {
    return invoke("add_to_failover_queue", { appType, providerId });
  },

  async removeFromFailoverQueue(
    appType: string,
    providerId: string,
  ): Promise<void> {
    return invoke("remove_from_failover_queue", { appType, providerId });
  },

  async getAutoFailoverEnabled(appType: string): Promise<boolean> {
    return invoke("get_auto_failover_enabled", { appType });
  },

  async setAutoFailoverEnabled(
    appType: string,
    enabled: boolean,
  ): Promise<void> {
    return invoke("set_auto_failover_enabled", { appType, enabled });
  },
};
