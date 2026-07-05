import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, KeyRound } from "lucide-react";
import { toast } from "sonner";
import type { SettingsFormState } from "@/hooks/useSettings";
import { ToggleRow } from "@/components/ui/toggle-row";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api";

interface CodexAuthSettingsProps {
  settings: SettingsFormState;

  onChange: (
    updates: Partial<SettingsFormState>,
  ) => void | boolean | Promise<void | boolean>;
}

export function CodexAuthSettings({
  settings,
  onChange,
}: CodexAuthSettingsProps) {
  const { t } = useTranslation();
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [hasUnifyBackup, setHasUnifyBackup] = useState(false);

  const handleUnifyHistoryChange = (checked: boolean) => {
    if (checked) {
      setShowEnableConfirm(true);
      return;
    }
    void settingsApi
      .hasCodexUnifyHistoryBackup()
      .catch(() => false)
      .then((hasBackup) => {
        setHasUnifyBackup(hasBackup);
        setShowDisableConfirm(true);
      });
  };

  const handleEnableConfirm = (migrateExisting: boolean) => {
    setShowEnableConfirm(false);
    void onChange({
      unifyCodexSessionHistory: true,
      unifyCodexMigrateExisting: migrateExisting,
    });
  };

  const showRestoreOption =
    hasUnifyBackup || (settings.unifyCodexMigrateExisting ?? false);

  const handleDisableConfirm = async (restoreBackup: boolean) => {
    setShowDisableConfirm(false);
    const saved = await onChange({
      unifyCodexSessionHistory: false,
      unifyCodexMigrateExisting: false,
    });
    if (saved === false) return;
    if (!restoreBackup) return;
    try {
      const result = await settingsApi.restoreCodexUnifiedHistory();
      if (result.skippedReason) {
        toast.info(
          result.skippedReason === "unify_toggle_on"
            ? t("settings.unifyCodexHistoryRestoreSkippedToggleOn")
            : t("settings.unifyCodexHistoryRestoreNothing"),
        );
        return;
      }
      toast.success(
        t("settings.unifyCodexHistoryRestoreCompleted", {
          files: result.restoredJsonlFiles,
          rows: result.restoredStateRows,
        }),
      );
    } catch (error) {
      console.error("Failed to restore codex unified history:", error);
      toast.error(t("settings.unifyCodexHistoryRestoreFailed"));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">{t("settings.codexAuth")}</h3>
      </div>

      <ToggleRow
        icon={<KeyRound className="h-4 w-4 text-emerald-500" />}
        title={t("settings.preserveCodexOfficialAuthOnSwitch")}
        description={t("settings.preserveCodexOfficialAuthOnSwitchDescription")}
        checked={settings.preserveCodexOfficialAuthOnSwitch ?? false}
        onCheckedChange={(value) =>
          onChange({ preserveCodexOfficialAuthOnSwitch: value })
        }
      />

      <ToggleRow
        icon={<History className="h-4 w-4 text-sky-500" />}
        title={t("settings.unifyCodexSessionHistory")}
        description={t("settings.unifyCodexSessionHistoryDescription")}
        checked={settings.unifyCodexSessionHistory ?? false}
        onCheckedChange={handleUnifyHistoryChange}
      />

      <ConfirmDialog
        isOpen={showEnableConfirm}
        title={t("confirm.unifyCodexHistory.title")}
        message={t("confirm.unifyCodexHistory.message")}
        checkboxLabel={t("confirm.unifyCodexHistory.migrateExisting")}
        confirmText={t("confirm.unifyCodexHistory.confirm")}
        onConfirm={handleEnableConfirm}
        onCancel={() => setShowEnableConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showDisableConfirm}
        title={t("confirm.unifyCodexHistoryOff.title")}
        message={t("confirm.unifyCodexHistoryOff.message")}
        checkboxLabel={
          showRestoreOption
            ? t("confirm.unifyCodexHistoryOff.restoreBackup")
            : undefined
        }
        checkboxDefaultChecked
        confirmText={t("confirm.unifyCodexHistoryOff.confirm")}
        onConfirm={(restoreBackup) => void handleDisableConfirm(restoreBackup)}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </section>
  );
}
