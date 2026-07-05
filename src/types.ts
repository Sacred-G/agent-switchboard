export type ProviderCategory =
  | "official"
  | "cn_official"
  | "cloud_provider"
  | "aggregator"
  | "third_party"
  | "custom"
  | "omo" // Oh My OpenCode
  | "omo-slim"; // Oh My OpenCode Slim

export interface Provider {
  id: string;
  name: string;
  settingsConfig: Record<string, any>;
  websiteUrl?: string;
  category?: ProviderCategory;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  isPartner?: boolean;
  meta?: ProviderMeta;
  icon?: string;
  iconColor?: string;
  inFailoverQueue?: boolean;
}

export interface AppConfig {
  providers: Record<string, Provider>;
  current: string;
}

export interface CustomEndpoint {
  url: string;
  addedAt: number;
  lastUsed?: number;
}

export interface EndpointCandidate {
  id?: string;
  url: string;
  isCustom?: boolean;
}

import type { TemplateType } from "./config/constants";

export interface UsageScript {
  enabled: boolean;
  language: "javascript";
  code: string;
  timeout?: number;
  templateType?: TemplateType;
  apiKey?: string;
  baseUrl?: string;
  accessToken?: string;
  userId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  codingPlanProvider?: string;
  autoQueryInterval?: number;
  autoIntervalMinutes?: number;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  };
}

const DEFAULT_USAGE_SCRIPT: UsageScript = {
  enabled: false,
  language: "javascript",
  code: "",
  timeout: 10,
  autoQueryInterval: 5,
};

export function createUsageScript(
  overrides?: Partial<UsageScript>,
): UsageScript {
  return { ...DEFAULT_USAGE_SCRIPT, ...overrides };
}

export interface UsageData {
  planName?: string;
  extra?: string;
  isValid?: boolean;
  invalidMessage?: string;
  total?: number;
  used?: number;
  remaining?: number;
  unit?: string;
}

export interface UsageResult {
  success: boolean;
  data?: UsageData[];
  error?: string;
}

export interface ProviderTestConfig {
  enabled: boolean;
  timeoutSecs?: number;
  degradedThresholdMs?: number;
  maxRetries?: number;
}

export type AuthBindingSource = "provider_config" | "managed_account";

export interface AuthBinding {
  source: AuthBindingSource;
  authProvider?: string;
  accountId?: string;
}

export interface ClaudeDesktopModelRoute {
  model: string;
  labelOverride?: string;
  supports1m?: boolean;
}

export type CodexChatThinkingParam =
  | "none"
  | "thinking"
  | "enable_thinking"
  | "reasoning_split";

export type CodexChatEffortParam =
  | "none"
  | "reasoning_effort"
  | "reasoning.effort";

export type CodexChatEffortValueMode =
  | "passthrough"
  | "low_high"
  | "deepseek"
  | "openrouter";

export type CodexChatReasoningOutputFormat =
  | "auto"
  | "reasoning_content"
  | "reasoning"
  | "reasoning_details"
  | "think_tags";

export interface CodexChatReasoning {
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  thinkingParam?: CodexChatThinkingParam;
  effortParam?: CodexChatEffortParam;
  effortValueMode?: CodexChatEffortValueMode;
  outputFormat?: CodexChatReasoningOutputFormat;
}

export interface LocalProxyRequestOverrides {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ProviderMeta {
  custom_endpoints?: Record<string, CustomEndpoint>;
  commonConfigEnabled?: boolean;
  claudeDesktopMode?: "direct" | "proxy";
  claudeDesktopModelRoutes?: Record<string, ClaudeDesktopModelRoute>;
  usage_script?: UsageScript;
  endpointAutoSelect?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  testConfig?: ProviderTestConfig;
  costMultiplier?: string;
  pricingModelSource?: string;
  apiFormat?:
    | "anthropic"
    | "openai_chat"
    | "openai_responses"
    | "gemini_native";
  authBinding?: AuthBinding;
  apiKeyField?: ClaudeApiKeyField;
  isFullUrl?: boolean;
  // Prompt cache key for OpenAI Responses-compatible endpoints (improves cache hit rate)
  promptCacheKey?: string;
  // Codex OAuth FAST mode: injects service_tier="priority" on ChatGPT Codex requests
  codexFastMode?: boolean;
  // Codex Responses -> Chat Completions reasoning capability metadata
  codexChatReasoning?: CodexChatReasoning;
  // Custom User-Agent for local proxy routing. Only applied by the local proxy.
  customUserAgent?: string;
  // Local proxy request overrides. Only applied by the local proxy after route transforms.
  localProxyRequestOverrides?: LocalProxyRequestOverrides;
  providerType?: string;
  githubAccountId?: string;
}

export type SkillSyncMethod = "auto" | "symlink" | "copy";

export type SkillStorageLocation = "cc_switch" | "unified";

export type ClaudeApiFormat =
  | "anthropic"
  | "openai_chat"
  | "openai_responses"
  | "gemini_native";

export type CodexApiFormat = "openai_responses" | "openai_chat";

export interface CodexCatalogModel {
  model: string;
  displayName?: string;
  contextWindow?: string | number;
}

export type ClaudeApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

export interface VisibleApps {
  claude: boolean;
  "claude-desktop": boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
  openclaw: boolean;
  hermes: boolean;
}

export interface WebDavSyncStatus {
  lastSyncAt?: number | null;
  lastError?: string | null;
  lastErrorSource?: string | null;
  lastRemoteEtag?: string | null;
  lastLocalManifestHash?: string | null;
  lastRemoteManifestHash?: string | null;
}

export interface WebDavSyncSettings {
  enabled?: boolean;
  autoSync?: boolean;
  baseUrl?: string;
  username?: string;
  password?: string;
  remoteRoot?: string;
  profile?: string;
  status?: WebDavSyncStatus;
}

export interface S3SyncSettings {
  enabled?: boolean;
  autoSync?: boolean;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  remoteRoot?: string;
  profile?: string;
  status?: WebDavSyncStatus;
}

export type RemoteSnapshotLayout = "current" | "legacy";

export interface RemoteSnapshotInfo {
  deviceName: string;
  createdAt: string;
  snapshotId: string;
  version: number;
  protocolVersion: number;
  dbCompatVersion?: number | null;
  compatible: boolean;
  artifacts: string[];
  layout: RemoteSnapshotLayout;
  remotePath: string;
}

export interface Settings {
  showInTray: boolean;
  minimizeToTrayOnClose: boolean;
  useAppWindowControls?: boolean;
  enableClaudePluginIntegration?: boolean;
  skipClaudeOnboarding?: boolean;
  launchOnStartup?: boolean;
  silentStartup?: boolean;
  enableLocalProxy?: boolean;
  // User has confirmed the local proxy first-run notice
  proxyConfirmed?: boolean;
  // User has confirmed the usage query first-run notice
  usageConfirmed?: boolean;
  // User has confirmed the stream check first-run notice
  streamCheckConfirmed?: boolean;
  // Whether to show the failover toggle independently on the main page
  enableFailoverToggle?: boolean;
  // Preserve Codex ChatGPT login in auth.json when switching third-party providers
  preserveCodexOfficialAuthOnSwitch?: boolean;
  // Run official Codex under the shared "custom" provider id so future
  // sessions share one resume-history bucket with third-party providers
  unifyCodexSessionHistory?: boolean;
  // User opted in (enable dialog checkbox) to migrate existing official sessions
  unifyCodexMigrateExisting?: boolean;
  // User has confirmed the failover toggle first-run notice
  failoverConfirmed?: boolean;
  // User has confirmed the first-run welcome notice
  firstRunNoticeConfirmed?: boolean;
  // User has confirmed the auto-sync traffic warning
  autoSyncConfirmed?: boolean;
  // User has confirmed the common config first-run notice
  commonConfigConfirmed?: boolean;
  language?: "en" | "zh" | "zh-TW" | "ja";

  visibleApps?: VisibleApps;

  claudeConfigDir?: string;
  codexConfigDir?: string;
  geminiConfigDir?: string;
  opencodeConfigDir?: string;
  openclawConfigDir?: string;
  hermesConfigDir?: string;

  currentProviderClaude?: string;
  currentProviderClaudeDesktop?: string;
  currentProviderCodex?: string;
  currentProviderGemini?: string;

  skillSyncMethod?: SkillSyncMethod;
  skillStorageLocation?: SkillStorageLocation;

  webdavSync?: WebDavSyncSettings;

  s3Sync?: S3SyncSettings;

  // Auto-backup interval in hours (0=disabled, default 24)
  backupIntervalHours?: number;
  // Maximum backup files to retain (default 10)
  backupRetainCount?: number;

  // macOS: "terminal" | "iterm2" | "warp" | "alacritty" | "kitty" | "ghostty" | "wezterm" | "kaku"
  // Windows: "cmd" | "powershell" | "wt"
  // Linux: "gnome-terminal" | "konsole" | "xfce4-terminal" | "alacritty" | "kitty" | "ghostty"
  preferredTerminal?: string;

  localMigrations?: {
    codexThirdPartyHistoryProviderBucketV1?: {
      completedAt: string;
      targetProviderId: string;
      sourceProviderIds?: string[];
      migratedJsonlFiles?: number;
      migratedStateRows?: number;
    };
  };
}

export interface SessionMeta {
  providerId: string;
  sessionId: string;
  title?: string;
  summary?: string;
  projectDir?: string | null;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath?: string;
  resumeCommand?: string;
}

export interface SessionMessage {
  role: string;
  content: string;
  ts?: number;
}

export interface McpServerSpec {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: any;
}

export interface McpApps {
  claude: boolean;
  "claude-desktop"?: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
  openclaw: boolean;
  hermes: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  server: McpServerSpec;
  apps: McpApps;
  description?: string;
  tags?: string[];
  homepage?: string;
  docs?: string;
  enabled?: boolean;
  source?: string;
  [key: string]: any;
}

export type McpServersMap = Record<string, McpServer>;

export interface McpStatus {
  userConfigPath: string;
  userConfigExists: boolean;
  serverCount: number;
}

export interface McpConfigResponse {
  configPath: string;
  servers: Record<string, McpServer>;
}

// ============================================================================
// ============================================================================

export interface UniversalProviderApps {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

export interface ClaudeModelConfig {
  model?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
}

export interface CodexModelConfig {
  model?: string;
  reasoningEffort?: string;
}

export interface GeminiModelConfig {
  model?: string;
}

export interface UniversalProviderModels {
  claude?: ClaudeModelConfig;
  codex?: CodexModelConfig;
  gemini?: GeminiModelConfig;
}

export interface UniversalProvider {
  id: string;
  name: string;
  providerType: string;
  apps: UniversalProviderApps;
  baseUrl: string;
  apiKey: string;
  models: UniversalProviderModels;
  websiteUrl?: string;
  notes?: string;
  icon?: string;
  iconColor?: string;
  meta?: ProviderMeta;
  createdAt?: number;
  sortIndex?: number;
}

export type UniversalProvidersMap = Record<string, UniversalProvider>;

// ============================================================================
// ============================================================================

export interface OpenCodeModel {
  name: string;
  limit?: {
    context?: number;
    output?: number;
  };
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenCodeProviderOptions {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface OpenCodeProviderConfig {
  npm: string;
  name?: string;
  options: OpenCodeProviderOptions;
  models: Record<string, OpenCodeModel>;
}

export interface OpenCodeMcpServerSpec {
  type: "local" | "remote";
  command?: string[];
  environment?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

// ============================================================================
// ============================================================================

export interface OpenClawModel {
  id: string;
  name: string;
  alias?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
}

export interface OpenClawDefaultModel {
  primary: string;
  fallbacks?: string[];
}

export interface OpenClawModelCatalogEntry {
  alias?: string;
}

export interface OpenClawHealthWarning {
  code: string;
  message: string;
  path?: string;
}

export interface OpenClawWriteOutcome {
  backupPath?: string;
  warnings: OpenClawHealthWarning[];
}

export type OpenClawToolsProfile = "minimal" | "coding" | "messaging" | "full";

export interface OpenClawProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: OpenClawModel[];
  headers?: Record<string, string>;
  authHeader?: boolean;
}

export interface OpenClawAgentsDefaults {
  model?: OpenClawDefaultModel;
  models?: Record<string, OpenClawModelCatalogEntry>;
  timeoutSeconds?: number;
  timeout?: number;
  [key: string]: unknown; // preserve unknown fields
}

export interface OpenClawEnvConfig {
  [key: string]: unknown;
}

export interface OpenClawToolsConfig {
  profile?: OpenClawToolsProfile | string;
  allow?: string[];
  deny?: string[];
  [key: string]: unknown; // preserve unknown fields
}

// ============================================================================
// ============================================================================

export interface HermesModelConfig {
  default?: string;
  provider?: string;
  base_url?: string;
  context_length?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export type HermesMemoryKind = "memory" | "user";

export interface HermesMemoryLimits {
  memory: number;
  user: number;
  memoryEnabled: boolean;
  userEnabled: boolean;
}
