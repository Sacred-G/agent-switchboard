import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  ProxyStatus,
  ProxyServerInfo,
  ProxyTakeoverStatus,
} from "@/types/proxy";
import { extractErrorMessage } from "@/utils/errorUtils";

export function useProxyStatus() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: status, isLoading } = useQuery({
    queryKey: ["proxyStatus"],
    queryFn: () => invoke<ProxyStatus>("get_proxy_status"),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    placeholderData: (previousData) => previousData,
  });

  const { data: takeoverStatus } = useQuery({
    queryKey: ["proxyTakeoverStatus"],
    queryFn: () => invoke<ProxyTakeoverStatus>("get_proxy_takeover_status"),
    placeholderData: (previousData) => previousData,
  });

  const startProxyServerMutation = useMutation({
    mutationFn: () => invoke<ProxyServerInfo>("start_proxy_server"),
    onSuccess: (info) => {
      toast.success(
        t("proxy.server.started", {
          address: info.address,
          port: info.port,
          defaultValue: `Proxy service started - ${info.address}:${info.port}`,
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Unknown" });
      toast.error(
        t("proxy.server.startFailed", {
          detail,
          defaultValue: `Failed to start proxy service: ${detail}`,
        }),
      );
    },
  });

  const stopProxyServerMutation = useMutation({
    mutationFn: () => invoke("stop_proxy_server"),
    onSuccess: () => {
      toast.success(
        t("proxy.server.stopped", {
          defaultValue: "Proxy service stopped",
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Unknown" });
      toast.error(
        t("proxy.server.stopFailed", {
          detail,
          defaultValue: `Failed to stop proxy service: ${detail}`,
        }),
      );
    },
  });

  const stopWithRestoreMutation = useMutation({
    mutationFn: () => invoke("stop_proxy_with_restore"),
    onSuccess: () => {
      toast.success(
        t("proxy.stoppedWithRestore", {
          defaultValue: "Routing service stopped, all routing configs restored",
        }),
        { closeButton: true },
      );
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      queryClient.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] });
      queryClient.removeQueries({ queryKey: ["providerHealth"] });
      queryClient.removeQueries({ queryKey: ["circuitBreakerStats"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Unknown" });
      toast.error(
        t("proxy.stopWithRestoreFailed", {
          detail,
          defaultValue: `Failed to stop: ${detail}`,
        }),
      );
    },
  });

  const setTakeoverForAppMutation = useMutation({
    mutationFn: ({ appType, enabled }: { appType: string; enabled: boolean }) =>
      invoke("set_proxy_takeover_for_app", { appType, enabled }),
    onSuccess: (_data, variables) => {
      const appLabel =
        variables.appType === "claude"
          ? "Claude"
          : variables.appType === "codex"
            ? "Codex"
            : variables.appType === "gemini"
              ? "Gemini"
              : "OpenCode";

      toast.success(
        variables.enabled
          ? t("proxy.takeover.enabled", {
              app: appLabel,
              defaultValue: `Taken over ${appLabel} configuration (requests will route through local proxy)`,
            })
          : t("proxy.takeover.disabled", {
              app: appLabel,
              defaultValue: `Restored ${appLabel} configuration`,
            }),
        { closeButton: true },
      );

      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      queryClient.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Unknown" });
      toast.error(
        t("proxy.takeover.failed", {
          detail,
          defaultValue: `Operation failed: ${detail}`,
        }),
      );
    },
  });

  const switchProxyProviderMutation = useMutation({
    mutationFn: ({
      appType,
      providerId,
    }: {
      appType: string;
      providerId: string;
    }) => invoke("switch_proxy_provider", { appType, providerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
    },
    onError: (error: Error) => {
      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "Unknown" });
      toast.error(
        t("proxy.switchFailed", {
          error: detail,
          defaultValue: `Switch failed: ${detail}`,
        }),
      );
    },
  });

  const checkRunning = async () => {
    try {
      return await invoke<boolean>("is_proxy_running");
    } catch {
      return false;
    }
  };

  const checkTakeoverActive = async () => {
    try {
      return await invoke<boolean>("is_live_takeover_active");
    } catch {
      return false;
    }
  };

  return {
    status,
    isLoading,
    isRunning: status?.running || false,
    takeoverStatus,
    isTakeoverActive:
      takeoverStatus?.claude ||
      takeoverStatus?.codex ||
      takeoverStatus?.gemini ||
      false,

    startProxyServer: startProxyServerMutation.mutateAsync,
    stopProxyServer: stopProxyServerMutation.mutateAsync,
    stopWithRestore: stopWithRestoreMutation.mutateAsync,

    setTakeoverForApp: setTakeoverForAppMutation.mutateAsync,

    switchProxyProvider: switchProxyProviderMutation.mutateAsync,

    checkRunning,
    checkTakeoverActive,

    isStarting: startProxyServerMutation.isPending,
    isStoppingServer: stopProxyServerMutation.isPending,
    isStopping: stopWithRestoreMutation.isPending,
    isPending:
      startProxyServerMutation.isPending ||
      stopProxyServerMutation.isPending ||
      stopWithRestoreMutation.isPending ||
      setTakeoverForAppMutation.isPending,
  };
}
