import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DatabaseUpgrade } from "./components/DatabaseUpgrade";
import { UpdateProvider } from "./contexts/UpdateContext";
import "./index.css";
import i18n from "./i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { exit } from "@tauri-apps/plugin-process";

try {
  const ua = navigator.userAgent || "";
  const plat = (navigator.platform || "").toLowerCase();
  const isMac = /mac/i.test(ua) || plat.includes("mac");
  if (isMac) {
    document.body.classList.add("is-mac");
  }
} catch {}

interface ConfigLoadErrorPayload {
  path?: string;
  error?: string;

  kind?: string;
}

async function handleConfigLoadError(
  payload: ConfigLoadErrorPayload | null,
): Promise<void> {
  const path = payload?.path ?? "~/.agent-switchboard/config.json";
  const detail = payload?.error ?? "Unknown error";

  await message(
    i18n.t("errors.configLoadFailedMessage", {
      path,
      detail,
      defaultValue:
        "Unable to read configuration file:\n{{path}}\n\nError details:\n{{detail}}\n\nPlease check if the JSON is valid, or restore from a backup file (e.g., config.json.bak) in the same directory.\n\nThe app will exit so you can fix this.",
    }),
    {
      title: i18n.t("errors.configLoadFailedTitle", {
        defaultValue: "Configuration Load Failed",
      }),
      kind: "error",
    },
  );

  await exit(1);
}

try {
  void listen("configLoadError", async (evt) => {
    await handleConfigLoadError(evt.payload as ConfigLoadErrorPayload | null);
  });
} catch (e) {
  console.error("Failed to subscribe to configLoadError event", e);
}

async function bootstrap() {
  try {
    const initError = (await invoke(
      "get_init_error",
    )) as ConfigLoadErrorPayload | null;
    if (initError && initError.kind === "db_version_too_new") {
      ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
          <ThemeProvider
            defaultTheme="system"
            storageKey="agent-switchboard-theme"
          >
            <DatabaseUpgrade payload={initError} />
            <Toaster />
          </ThemeProvider>
        </React.StrictMode>,
      );
      return;
    }
    if (initError && (initError.path || initError.error)) {
      await handleConfigLoadError(initError);
      return;
    }
  } catch (e) {
    console.error("Failed to pull initialization error", e);
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          defaultTheme="system"
          storageKey="agent-switchboard-theme"
        >
          <UpdateProvider>
            <App />
            <Toaster />
          </UpdateProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
