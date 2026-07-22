import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  RotateCw,
  X,
} from "lucide-react";
import { settingsApi } from "@/lib/api";
import { webBoardStore, type WebPage } from "./store";

interface WebPagePaneProps {
  page: WebPage;
  index: number;
  total: number;
}

export function WebPagePane({ page, index, total }: WebPagePaneProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(page.url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDraft(page.url);
    setFailed(false);
  }, [page.url, page.reloadNonce]);

  const commit = () => {
    if (draft.trim() && draft.trim() !== page.url) {
      webBoardStore.setPageUrl(page.id, draft);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/60 px-1.5">
        <button
          type="button"
          onClick={() => webBoardStore.movePage(page.id, -1)}
          disabled={index === 0}
          title={t("webBoard.moveLeft")}
          className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => webBoardStore.movePage(page.id, 1)}
          disabled={index === total - 1}
          title={t("webBoard.moveRight")}
          className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder={t("webBoard.urlPlaceholder")}
          className="h-6 min-w-0 flex-1 rounded border border-border-default bg-background px-2 font-mono text-[11px] outline-none focus:border-blue-500/40"
        />
        <button
          type="button"
          onClick={() => webBoardStore.reloadPage(page.id)}
          disabled={!page.url}
          title={t("webBoard.reload")}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => page.url && void settingsApi.openExternal(page.url)}
          disabled={!page.url}
          title={t("webBoard.openInBrowser")}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => webBoardStore.removePage(page.id)}
          title={t("webBoard.removePage")}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-red-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {page.url && !failed ? (
          <iframe
            key={`${page.url}:${page.reloadNonce}`}
            src={page.url}
            title={page.title || t("webBoard.pageTitle", { index: index + 1 })}
            className="absolute inset-0 h-full w-full border-0"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <Globe className="h-6 w-6 opacity-40" />
            {page.url ? (
              <>
                <p>{t("webBoard.loadFailed")}</p>
                <button
                  type="button"
                  onClick={() => void settingsApi.openExternal(page.url)}
                  className="text-blue-500 hover:underline"
                >
                  {t("webBoard.openInBrowser")}
                </button>
              </>
            ) : (
              <p>{t("webBoard.emptyPage")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
