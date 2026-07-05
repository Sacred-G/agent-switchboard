import { cn } from "@/lib/utils";
import { ProviderHealthStatus } from "@/types/proxy";
import { useTranslation } from "react-i18next";

interface ProviderHealthBadgeProps {
  consecutiveFailures: number;
  isHealthy?: boolean;
  className?: string;
}

export function ProviderHealthBadge({
  consecutiveFailures,
  isHealthy,
  className,
}: ProviderHealthBadgeProps) {
  const { t } = useTranslation();

  const getStatus = () => {
    if (consecutiveFailures === 0) {
      return {
        labelKey: "health.operational",
        labelFallback: "Normal",
        status: ProviderHealthStatus.Healthy,
        color: "bg-green-500",
        bgColor: "bg-green-500/10",
        textColor: "text-green-600 dark:text-green-400",
      };
    } else if (isHealthy !== false) {
      return {
        labelKey: "health.degraded",
        labelFallback: "Degraded",
        status: ProviderHealthStatus.Degraded,
        color: "bg-yellow-500",
        bgColor: "bg-yellow-500/10",
        textColor: "text-yellow-600 dark:text-yellow-400",
      };
    } else {
      return {
        labelKey: "health.circuitOpen",
        labelFallback: "Circuit Broken",
        status: ProviderHealthStatus.Failed,
        color: "bg-red-500",
        bgColor: "bg-red-500/10",
        textColor: "text-red-600 dark:text-red-400",
      };
    }
  };

  const statusConfig = getStatus();
  const label = t(statusConfig.labelKey, {
    defaultValue: statusConfig.labelFallback,
  });

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
        statusConfig.bgColor,
        statusConfig.textColor,
        className,
      )}
      title={t("health.consecutiveFailures", {
        count: consecutiveFailures,
        defaultValue: `Consecutive failures: ${consecutiveFailures}`,
      })}
    >
      <div className={cn("w-2 h-2 rounded-full", statusConfig.color)} />
      <span>{label}</span>
    </div>
  );
}
