import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getGlobalProxyUrl,
  setGlobalProxyUrl,
  testProxyUrl,
  getUpstreamProxyStatus,
  scanLocalProxies,
  type ProxyTestResult,
  type UpstreamProxyStatus,
  type DetectedProxy,
} from "@/lib/api/globalProxy";

export function useGlobalProxyUrl() {
  return useQuery({
    queryKey: ["globalProxyUrl"],
    queryFn: getGlobalProxyUrl,
    staleTime: 30 * 1000,
  });
}

export function useSetGlobalProxyUrl() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: setGlobalProxyUrl,
    onSuccess: () => {
      toast.success(t("settings.globalProxy.saved"));
      queryClient.invalidateQueries({ queryKey: ["globalProxyUrl"] });
      queryClient.invalidateQueries({ queryKey: ["upstreamProxyStatus"] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown error";
      toast.error(t("settings.globalProxy.saveFailed", { error: message }));
    },
  });
}

export function useTestProxy() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: testProxyUrl,
    onSuccess: (result: ProxyTestResult) => {
      if (result.success) {
        toast.success(
          t("settings.globalProxy.testSuccess", { latency: result.latencyMs }),
        );
      } else {
        toast.error(
          t("settings.globalProxy.testFailed", { error: result.error }),
        );
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useUpstreamProxyStatus() {
  return useQuery<UpstreamProxyStatus>({
    queryKey: ["upstreamProxyStatus"],
    queryFn: getUpstreamProxyStatus,
  });
}

export function useScanProxies() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: scanLocalProxies,
    onError: (error: Error) => {
      toast.error(
        t("settings.globalProxy.scanFailed", { error: error.message }),
      );
    },
  });
}

export type { DetectedProxy };
