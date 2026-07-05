import { Shuffle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  useAutoFailoverEnabled,
  useSetAutoFailoverEnabled,
} from "@/lib/query/failover";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";

interface FailoverToggleProps {
  className?: string;
  activeApp: AppId;
}

export function FailoverToggle({ className, activeApp }: FailoverToggleProps) {
  const { t } = useTranslation();
  const { data: isEnabled = false, isLoading } =
    useAutoFailoverEnabled(activeApp);
  const setEnabled = useSetAutoFailoverEnabled();
  const { takeoverStatus } = useProxyStatus();
  const takeoverEnabled = takeoverStatus?.[activeApp] ?? false;

  const handleToggle = (checked: boolean) => {
    if (checked && !takeoverEnabled) return;
    setEnabled.mutate({ appType: activeApp, enabled: checked });
  };

  const appLabel =
    activeApp === "claude"
      ? "Claude"
      : activeApp === "codex"
        ? "Codex"
        : "Gemini";

  const tooltipText = !takeoverEnabled
    ? t("failover.tooltip.takeoverRequired", {
        app: appLabel,
        defaultValue: `Please take over ${appLabel} first, then enable failover`,
      })
    : isEnabled
      ? t("failover.tooltip.enabled", {
          app: appLabel,
          defaultValue: `${appLabel} Failover enabled\nSelect provider by queue priority (P1->P2->...)`,
        })
      : t("failover.tooltip.disabled", {
          app: appLabel,
          defaultValue: `Enable ${appLabel} failover\nWill switch immediately to queue P1 and auto-switch to next upon failure`,
        });

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1.5 h-8 rounded-lg bg-muted/50 transition-all",
        className,
      )}
      title={tooltipText}
    >
      {setEnabled.isPending || isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Shuffle
          className={cn(
            "h-4 w-4 transition-colors",
            isEnabled
              ? "text-emerald-500 animate-pulse"
              : "text-muted-foreground",
          )}
        />
      )}
      <Switch
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={setEnabled.isPending || isLoading || !takeoverEnabled}
      />
    </div>
  );
}
