import React from "react";
import { RefreshCw, AlertCircle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type AppId } from "@/lib/api";
import { useUsageQuery } from "@/lib/query/queries";
import { UsageData, Provider } from "@/types";
import { TierBadge } from "@/components/SubscriptionQuotaFooter";
import type { QuotaTier } from "@/types/subscription";

interface UsageFooterProps {
  provider: Provider;
  providerId: string;
  appId: AppId;
  usageEnabled: boolean;
  isCurrent: boolean;
  isInConfig?: boolean;
  inline?: boolean;
}

function toQuotaTier(data: UsageData): QuotaTier {
  const extra = data.extra;
  if (extra && extra.startsWith("{")) {
    try {
      const parsed = JSON.parse(extra);
      return {
        name: data.planName || "",
        utilization: data.used || 0,
        resetsAt: parsed.resetsAt || null,
        usedValueUsd: parsed.usedValueUsd ?? null,
        maxValueUsd: parsed.maxValueUsd ?? null,
        planLabel: parsed.planLabel ?? null,
      };
    } catch {
      // fall through to plain string
    }
  }
  return {
    name: data.planName || "",
    utilization: data.used || 0,
    resetsAt: extra || null,
  };
}

const UsageFooter: React.FC<UsageFooterProps> = ({
  provider,
  providerId,
  appId,
  usageEnabled,
  isCurrent,
  isInConfig = false,
  inline = false,
}) => {
  const { t } = useTranslation();
  const isTokenPlan =
    provider.meta?.usage_script?.templateType === "token_plan";

  const shouldAutoQuery = appId === "opencode" ? isInConfig : isCurrent;
  const autoQueryInterval = shouldAutoQuery
    ? provider.meta?.usage_script?.autoQueryInterval || 0
    : 0;

  const {
    data: usage,
    isFetching: loading,
    lastQueriedAt,
    refetch,
  } = useUsageQuery(providerId, appId, {
    enabled: usageEnabled,
    autoQueryInterval,
  });

  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    if (!lastQueriedAt) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => clearInterval(interval);
  }, [lastQueriedAt]);

  if (!usageEnabled || !usage) return null;

  if (!usage.success) {
    if (inline) {
      return (
        <div className="inline-flex items-center gap-2 text-xs rounded-lg border border-border-default bg-card px-3 py-2 shadow-sm">
          <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
            <AlertCircle size={12} />
            <span>{t("usage.queryFailed")}</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50 flex-shrink-0"
            title={t("usage.refreshUsage")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-xl border border-border-default bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-red-500 dark:text-red-400">
            <AlertCircle size={14} />
            <span>{usage.error || t("usage.queryFailed")}</span>
          </div>

          {}
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 flex-shrink-0"
            title={t("usage.refreshUsage")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
    );
  }

  const usageDataList = usage.data || [];

  if (usageDataList.length === 0) return null;

  if (isTokenPlan && inline) {
    return (
      <div className="flex flex-col items-end gap-1 text-xs whitespace-nowrap flex-shrink-0">
        {}
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
            <Clock size={10} />
            {lastQueriedAt
              ? formatRelativeTime(lastQueriedAt, now, t)
              : t("usage.never", { defaultValue: "Never" })}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              refetch();
            }}
            disabled={loading}
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50 flex-shrink-0 text-muted-foreground"
            title={t("usage.refreshUsage")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {}
        <div className="flex items-center gap-2">
          {(() => {
            const tiers = usageDataList.map((d) => toQuotaTier(d));
            const planLabel = tiers[0]?.planLabel;
            return (
              <>
                {planLabel && (
                  <span className="font-semibold text-muted-foreground">
                    💰 {planLabel}
                  </span>
                )}
                {tiers.map((tier, index) => (
                  <TierBadge key={index} tier={tier} t={t} />
                ))}
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  if (inline) {
    const firstUsage = usageDataList[0];
    const isExpired = firstUsage.isValid === false;

    return (
      <div className="flex flex-col items-end gap-1 text-xs whitespace-nowrap flex-shrink-0">
        {}
        <div className="flex items-center gap-2 justify-end">
          {}
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
            <Clock size={10} />
            {lastQueriedAt
              ? formatRelativeTime(lastQueriedAt, now, t)
              : t("usage.never", { defaultValue: "Never" })}
          </span>

          {}
          <button
            onClick={(e) => {
              e.stopPropagation();
              refetch();
            }}
            disabled={loading}
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50 flex-shrink-0 text-muted-foreground"
            title={t("usage.refreshUsage")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {}
        <div className="flex items-center gap-2">
          {}
          {firstUsage.used !== undefined && (
            <div className="flex items-center gap-0.5">
              <span className="text-gray-500 dark:text-gray-400">
                {t("usage.used")}
              </span>
              <span className="tabular-nums text-gray-600 dark:text-gray-400 font-medium">
                {firstUsage.used.toFixed(2)}
              </span>
            </div>
          )}

          {}
          {firstUsage.remaining !== undefined && (
            <div className="flex items-center gap-0.5">
              <span className="text-gray-500 dark:text-gray-400">
                {t("usage.remaining")}
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  isExpired
                    ? "text-red-500 dark:text-red-400"
                    : firstUsage.remaining <
                        (firstUsage.total || firstUsage.remaining) * 0.1
                      ? "text-orange-500 dark:text-orange-400"
                      : "text-green-600 dark:text-green-400"
                }`}
              >
                {firstUsage.remaining.toFixed(2)}
              </span>
            </div>
          )}

          {}
          {firstUsage.unit && (
            <span className="text-gray-500 dark:text-gray-400">
              {firstUsage.unit}
            </span>
          )}

          {}
          {firstUsage.extra && (
            <span
              className="text-gray-500 dark:text-gray-400 truncate max-w-[150px]"
              title={firstUsage.extra}
            >
              {firstUsage.extra}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border-default bg-card px-4 py-3 shadow-sm">
      {}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {t("usage.planUsage")}
        </span>
        <div className="flex items-center gap-2">
          {}
          {lastQueriedAt && (
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Clock size={10} />
              {formatRelativeTime(lastQueriedAt, now, t)}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
            title={t("usage.refreshUsage")}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {}
      <div className="flex flex-col gap-3">
        {usageDataList.map((usageData, index) => (
          <UsagePlanItem key={index} data={usageData} />
        ))}
      </div>
    </div>
  );
};

const UsagePlanItem: React.FC<{ data: UsageData }> = ({ data }) => {
  const { t } = useTranslation();
  const {
    planName,
    extra,
    isValid,
    invalidMessage,
    total,
    used,
    remaining,
    unit,
  } = data;

  const isExpired = isValid === false;

  return (
    <div className="flex items-center gap-3">
      {}
      <div
        className="text-xs text-gray-500 dark:text-gray-400 min-w-0"
        style={{ width: "25%" }}
      >
        {planName ? (
          <span
            className={`font-medium truncate block ${isExpired ? "text-red-500 dark:text-red-400" : ""}`}
            title={planName}
          >
            💰 {planName}
          </span>
        ) : (
          <span className="opacity-50">—</span>
        )}
      </div>

      {}
      <div
        className="text-xs text-gray-500 dark:text-gray-400 min-w-0 flex items-center gap-2"
        style={{ width: "30%" }}
      >
        {extra && (
          <span
            className={`truncate ${isExpired ? "text-red-500 dark:text-red-400" : ""}`}
            title={extra}
          >
            {extra}
          </span>
        )}
        {isExpired && (
          <span className="text-red-500 dark:text-red-400 font-medium text-[10px] px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 rounded flex-shrink-0">
            {invalidMessage || t("usage.invalid")}
          </span>
        )}
      </div>

      {}
      <div
        className="flex items-center justify-end gap-2 text-xs flex-shrink-0"
        style={{ width: "45%" }}
      >
        {}
        {total !== undefined && (
          <>
            <span className="text-gray-500 dark:text-gray-400">
              {t("usage.total")}
            </span>
            <span className="tabular-nums text-gray-600 dark:text-gray-400">
              {total === -1 ? "∞" : total.toFixed(2)}
            </span>
            <span className="text-gray-400 dark:text-gray-600">|</span>
          </>
        )}

        {}
        {used !== undefined && (
          <>
            <span className="text-gray-500 dark:text-gray-400">
              {t("usage.used")}
            </span>
            <span className="tabular-nums text-gray-600 dark:text-gray-400">
              {used.toFixed(2)}
            </span>
            <span className="text-gray-400 dark:text-gray-600">|</span>
          </>
        )}

        {}
        {remaining !== undefined && (
          <>
            <span className="text-gray-500 dark:text-gray-400">
              {t("usage.remaining")}
            </span>
            <span
              className={`font-semibold tabular-nums ${
                isExpired
                  ? "text-red-500 dark:text-red-400"
                  : remaining < (total || remaining) * 0.1
                    ? "text-orange-500 dark:text-orange-400"
                    : "text-green-600 dark:text-green-400"
              }`}
            >
              {remaining.toFixed(2)}
            </span>
          </>
        )}

        {unit && (
          <span className="text-gray-500 dark:text-gray-400">{unit}</span>
        )}
      </div>
    </div>
  );
};

function formatRelativeTime(
  timestamp: number,
  now: number,
  t: (key: string, options?: { count?: number }) => string,
): string {
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 60) {
    return t("usage.justNow");
  } else if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return t("usage.minutesAgo", { count: minutes });
  } else if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return t("usage.hoursAgo", { count: hours });
  } else {
    const days = Math.floor(diff / 86400);
    return t("usage.daysAgo", { count: days });
  }
}

export default UsageFooter;
