import { TFunction } from "i18next";

export interface SkillError {
  code: string;
  context: Record<string, string>;
  suggestion?: string;
}

export function parseSkillError(errorString: string): SkillError | null {
  try {
    const parsed = JSON.parse(errorString);
    if (parsed.code && parsed.context) {
      return parsed as SkillError;
    }
  } catch {}
  return null;
}

function getErrorI18nKey(code: string): string {
  const mapping: Record<string, string> = {
    SKILL_NOT_FOUND: "skills.error.skillNotFound",
    MISSING_REPO_INFO: "skills.error.missingRepoInfo",
    DOWNLOAD_TIMEOUT: "skills.error.downloadTimeout",
    DOWNLOAD_FAILED: "skills.error.downloadFailed",
    SKILL_DIR_NOT_FOUND: "skills.error.skillDirNotFound",
    SKILL_DIRECTORY_CONFLICT: "skills.error.directoryConflict",
    EMPTY_ARCHIVE: "skills.error.emptyArchive",
    GET_HOME_DIR_FAILED: "skills.error.getHomeDirFailed",
    NO_SKILLS_IN_ZIP: "skills.error.noSkillsInZip",
  };

  return mapping[code] || "skills.error.unknownError";
}

function getSuggestionI18nKey(suggestion: string): string {
  const mapping: Record<string, string> = {
    checkNetwork: "skills.error.suggestion.checkNetwork",
    checkProxy: "skills.error.suggestion.checkProxy",
    retryLater: "skills.error.suggestion.retryLater",
    checkRepoUrl: "skills.error.suggestion.checkRepoUrl",
    checkPermission: "skills.error.suggestion.checkPermission",
    uninstallFirst: "skills.error.suggestion.uninstallFirst",
    checkZipContent: "skills.error.suggestion.checkZipContent",
    http403: "skills.error.http403",
    http404: "skills.error.http404",
    http429: "skills.error.http429",
  };

  return mapping[suggestion] || suggestion;
}

export function formatSkillError(
  errorString: string,
  t: TFunction,
  defaultTitle: string = "skills.installFailed",
): { title: string; description: string } {
  const parsedError = parseSkillError(errorString);

  if (!parsedError) {
    return {
      title: t(defaultTitle),
      description: errorString || t("common.error"),
    };
  }

  const { code, context, suggestion } = parsedError;

  const errorKey = getErrorI18nKey(code);

  let description = t(errorKey, context);

  if (suggestion) {
    const suggestionKey = getSuggestionI18nKey(suggestion);
    const suggestionText = t(suggestionKey);
    description += `\n\n${suggestionText}`;
  }

  return {
    title: t(defaultTitle),
    description,
  };
}
