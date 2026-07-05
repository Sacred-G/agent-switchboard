import { useRef } from "react";
import {
  useQuery,
  type UseQueryResult,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  providersApi,
  settingsApi,
  usageApi,
  sessionsApi,
  type AppId,
} from "@/lib/api";
import type {
  Provider,
  Settings,
  UsageResult,
  SessionMeta,
  SessionMessage,
} from "@/types";
import { usageKeys } from "@/lib/query/usage";

const sortProviders = (
  providers: Record<string, Provider>,
): Record<string, Provider> => {
  const sortedEntries = Object.values(providers)
    .sort((a, b) => {
      const indexA = a.sortIndex ?? Number.MAX_SAFE_INTEGER;
      const indexB = b.sortIndex ?? Number.MAX_SAFE_INTEGER;
      if (indexA !== indexB) {
        return indexA - indexB;
      }

      const timeA = a.createdAt ?? 0;
      const timeB = b.createdAt ?? 0;
      if (timeA === timeB) {
        return a.name.localeCompare(b.name, "zh-CN");
      }
      return timeA - timeB;
    })
    .map((provider) => [provider.id, provider] as const);

  return Object.fromEntries(sortedEntries);
};

export interface ProvidersQueryData {
  providers: Record<string, Provider>;
  currentProviderId: string;
}

export interface UseProvidersQueryOptions {
  isProxyRunning?: boolean;
}

export const useProvidersQuery = (
  appId: AppId,
  options?: UseProvidersQueryOptions,
): UseQueryResult<ProvidersQueryData> => {
  const { isProxyRunning = false } = options || {};

  return useQuery({
    queryKey: ["providers", appId],
    placeholderData: keepPreviousData,
    refetchInterval: isProxyRunning ? 10000 : false,
    queryFn: async () => {
      let providers: Record<string, Provider> = {};
      let currentProviderId = "";

      try {
        providers = await providersApi.getAll(appId);
      } catch (error) {
        console.error("Failed to get provider list:", error);
      }

      try {
        currentProviderId = await providersApi.getCurrent(appId);
      } catch (error) {
        console.error("Failed to get current provider:", error);
      }

      return {
        providers: sortProviders(providers),
        currentProviderId,
      };
    },
  });
};

export const useSettingsQuery = (): UseQueryResult<Settings> => {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => settingsApi.get(),
  });
};

export interface UseUsageQueryOptions {
  enabled?: boolean;
  autoQueryInterval?: number;
}

export interface LastGoodUsage {
  data: UsageResult;
  at: number;
}

export const KEEP_LAST_GOOD_MS = 10 * 60 * 1000;

export function isTransientUsageError(result: UsageResult): boolean {
  if (result.success) return false;
  const e = result.error?.toLowerCase() ?? "";
  if (!e) return false;

  if (
    e.includes("network error") ||
    e.includes("request failed") ||
    e.includes("Request failed") ||
    e.includes("failed to read response") ||
    e.includes("Failed to read response")
  ) {
    return true;
  }

  const httpMatch = e.match(/http\s+(\d{3})/);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return status >= 500 && status <= 599;
  }

  return false;
}

export function resolveDisplayUsage(
  raw: UsageResult | undefined,
  dataUpdatedAt: number,
  prevLastGood: LastGoodUsage | null,
  now: number,
  keepMs: number = KEEP_LAST_GOOD_MS,
): {
  data: UsageResult | undefined;
  lastQueriedAt: number | null;
  lastGood: LastGoodUsage | null;
} {
  let lastGood = prevLastGood;
  if (raw?.success) {
    lastGood = { data: raw, at: dataUpdatedAt || now };
  } else if (raw && !isTransientUsageError(raw)) {
    lastGood = null;
  }

  let data = raw;
  let lastQueriedAt = dataUpdatedAt || null;
  if (
    raw &&
    !raw.success &&
    isTransientUsageError(raw) &&
    lastGood &&
    now - lastGood.at < keepMs
  ) {
    data = lastGood.data;
    lastQueriedAt = lastGood.at;
  }

  return { data, lastQueriedAt, lastGood };
}

export const useUsageQuery = (
  providerId: string,
  appId: AppId,
  options?: UseUsageQueryOptions,
) => {
  const { enabled = true, autoQueryInterval = 0 } = options || {};

  const staleTime =
    autoQueryInterval > 0 ? autoQueryInterval * 60 * 1000 : 5 * 60 * 1000;

  const query = useQuery<UsageResult>({
    queryKey: usageKeys.script(providerId, appId),
    queryFn: async () => usageApi.query(providerId, appId),
    enabled: enabled && !!providerId,
    refetchInterval:
      autoQueryInterval > 0
        ? Math.max(autoQueryInterval, 1) * 60 * 1000
        : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1500,
    staleTime,
    gcTime: 10 * 60 * 1000,
  });

  const lastGoodRef = useRef<LastGoodUsage | null>(null);
  const { data, lastQueriedAt, lastGood } = resolveDisplayUsage(
    query.data,
    query.dataUpdatedAt,
    lastGoodRef.current,
    Date.now(),
  );
  lastGoodRef.current = lastGood;

  return {
    ...query,
    data,
    lastQueriedAt,
  };
};

export const useSessionsQuery = () => {
  return useQuery<SessionMeta[]>({
    queryKey: ["sessions"],
    queryFn: async () => sessionsApi.list(),
    staleTime: 30 * 1000,
  });
};

export const useSessionMessagesQuery = (
  providerId?: string,
  sourcePath?: string,
) => {
  return useQuery<SessionMessage[]>({
    queryKey: ["sessionMessages", providerId, sourcePath],
    queryFn: async () => sessionsApi.getMessages(providerId!, sourcePath!),
    enabled: Boolean(providerId && sourcePath),
    staleTime: 30 * 1000,
  });
};
