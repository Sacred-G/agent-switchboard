use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

use crate::services::skill::SkillStore;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct McpApps {
    #[serde(default)]
    pub claude: bool,
    #[serde(default)]
    pub codex: bool,
    #[serde(default)]
    pub gemini: bool,
    #[serde(default)]
    pub opencode: bool,
    #[serde(default)]
    pub hermes: bool,
}

impl McpApps {
    pub fn is_enabled_for(&self, app: &AppType) -> bool {
        match app {
            AppType::Claude => self.claude,
            AppType::Codex => self.codex,
            AppType::Gemini => self.gemini,
            AppType::OpenCode => self.opencode,
            AppType::OpenClaw => false, // OpenClaw doesn't support MCP
            AppType::Hermes => self.hermes,
            AppType::ClaudeDesktop => false,
        }
    }

    pub fn set_enabled_for(&mut self, app: &AppType, enabled: bool) {
        match app {
            AppType::Claude => self.claude = enabled,
            AppType::Codex => self.codex = enabled,
            AppType::Gemini => self.gemini = enabled,
            AppType::OpenCode => self.opencode = enabled,
            AppType::OpenClaw => {} // OpenClaw doesn't support MCP, ignore
            AppType::Hermes => self.hermes = enabled,
            AppType::ClaudeDesktop => {} // Claude Desktop 3P provider config doesn't support MCP here
        }
    }

    pub fn enabled_apps(&self) -> Vec<AppType> {
        let mut apps = Vec::new();
        if self.claude {
            apps.push(AppType::Claude);
        }
        if self.codex {
            apps.push(AppType::Codex);
        }
        if self.gemini {
            apps.push(AppType::Gemini);
        }
        if self.opencode {
            apps.push(AppType::OpenCode);
        }
        if self.hermes {
            apps.push(AppType::Hermes);
        }
        apps
    }

    pub fn is_empty(&self) -> bool {
        !self.claude && !self.codex && !self.gemini && !self.opencode && !self.hermes
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SkillApps {
    #[serde(default)]
    pub claude: bool,
    #[serde(default)]
    pub codex: bool,
    #[serde(default)]
    pub gemini: bool,
    #[serde(default)]
    pub opencode: bool,
    #[serde(default)]
    pub hermes: bool,
}

impl SkillApps {
    pub fn is_enabled_for(&self, app: &AppType) -> bool {
        match app {
            AppType::Claude => self.claude,
            AppType::Codex => self.codex,
            AppType::Gemini => self.gemini,
            AppType::OpenCode => self.opencode,
            AppType::Hermes => self.hermes,
            AppType::OpenClaw => false, // OpenClaw doesn't support Skills
            AppType::ClaudeDesktop => false,
        }
    }

    pub fn set_enabled_for(&mut self, app: &AppType, enabled: bool) {
        match app {
            AppType::Claude => self.claude = enabled,
            AppType::Codex => self.codex = enabled,
            AppType::Gemini => self.gemini = enabled,
            AppType::OpenCode => self.opencode = enabled,
            AppType::Hermes => self.hermes = enabled,
            AppType::OpenClaw => {} // OpenClaw doesn't support Skills, ignore
            AppType::ClaudeDesktop => {} // Claude Desktop 3P profiles don't use Agent Switchboard skill sync
        }
    }

    pub fn enabled_apps(&self) -> Vec<AppType> {
        let mut apps = Vec::new();
        if self.claude {
            apps.push(AppType::Claude);
        }
        if self.codex {
            apps.push(AppType::Codex);
        }
        if self.gemini {
            apps.push(AppType::Gemini);
        }
        if self.opencode {
            apps.push(AppType::OpenCode);
        }
        if self.hermes {
            apps.push(AppType::Hermes);
        }
        apps
    }

    pub fn is_empty(&self) -> bool {
        !self.claude && !self.codex && !self.gemini && !self.opencode && !self.hermes
    }

    pub fn only(app: &AppType) -> Self {
        let mut apps = Self::default();
        apps.set_enabled_for(app, true);
        apps
    }

    ///
    pub fn from_labels(labels: &[String]) -> Self {
        let mut apps = Self::default();
        for label in labels {
            if let Ok(app) = label.parse::<AppType>() {
                apps.set_enabled_for(&app, true);
            }
        }
        apps
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
    /// README URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readme_url: Option<String>,
    pub apps: SkillApps,
    pub installed_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedSkill {
    pub directory: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub found_in: Vec<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub server: serde_json::Value,
    pub apps: McpApps,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(default)]
    pub servers: HashMap<String, serde_json::Value>,
}

impl McpConfig {
    pub fn is_empty(&self) -> bool {
        self.servers.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRoot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub servers: Option<HashMap<String, McpServer>>,

    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub claude: McpConfig,
    #[serde(
        rename = "claude-desktop",
        alias = "claudeDesktop",
        alias = "claude_desktop",
        default,
        skip_serializing_if = "McpConfig::is_empty"
    )]
    pub claude_desktop: McpConfig,
    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub codex: McpConfig,
    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub gemini: McpConfig,
    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub opencode: McpConfig,
    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub openclaw: McpConfig,
    #[serde(default, skip_serializing_if = "McpConfig::is_empty")]
    pub hermes: McpConfig,
}

impl Default for McpRoot {
    fn default() -> Self {
        Self {
            servers: Some(HashMap::new()),
            claude: McpConfig::default(),
            claude_desktop: McpConfig::default(),
            codex: McpConfig::default(),
            gemini: McpConfig::default(),
            opencode: McpConfig::default(),
            openclaw: McpConfig::default(),
            hermes: McpConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromptConfig {
    #[serde(default)]
    pub prompts: HashMap<String, crate::prompt::Prompt>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromptRoot {
    #[serde(default)]
    pub claude: PromptConfig,
    #[serde(
        rename = "claude-desktop",
        alias = "claudeDesktop",
        alias = "claude_desktop",
        default
    )]
    pub claude_desktop: PromptConfig,
    #[serde(default)]
    pub codex: PromptConfig,
    #[serde(default)]
    pub gemini: PromptConfig,
    #[serde(default)]
    pub opencode: PromptConfig,
    #[serde(default)]
    pub openclaw: PromptConfig,
    #[serde(default)]
    pub hermes: PromptConfig,
}

use crate::config::{copy_file, get_app_config_dir, get_app_config_path, write_json_file};
use crate::error::AppError;
use crate::prompt_files::prompt_file_path;
use crate::provider::ProviderManager;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppType {
    Claude,
    #[serde(
        rename = "claude-desktop",
        alias = "claude_desktop",
        alias = "claudeDesktop"
    )]
    ClaudeDesktop,
    Codex,
    Gemini,
    OpenCode,
    OpenClaw,
    Hermes,
}

impl AppType {
    pub fn as_str(&self) -> &str {
        match self {
            AppType::Claude => "claude",
            AppType::ClaudeDesktop => "claude-desktop",
            AppType::Codex => "codex",
            AppType::Gemini => "gemini",
            AppType::OpenCode => "opencode",
            AppType::OpenClaw => "openclaw",
            AppType::Hermes => "hermes",
        }
    }

    /// Check if this app uses additive mode
    ///
    /// - Switch mode (false): Only the current provider is written to live config (Claude, Codex, Gemini)
    /// - Additive mode (true): All providers are written to live config (OpenCode, OpenClaw, Hermes)
    pub fn is_additive_mode(&self) -> bool {
        matches!(
            self,
            AppType::OpenCode | AppType::OpenClaw | AppType::Hermes
        )
    }

    /// Return an iterator over all app types
    pub fn all() -> impl Iterator<Item = AppType> {
        [
            AppType::Claude,
            AppType::ClaudeDesktop,
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
            AppType::OpenClaw,
            AppType::Hermes,
        ]
        .into_iter()
    }
}

impl FromStr for AppType {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let normalized = s.trim().to_lowercase();
        match normalized.as_str() {
            "claude" => Ok(AppType::Claude),
            "claude-desktop" | "claude_desktop" | "claudedesktop" => Ok(AppType::ClaudeDesktop),
            "codex" => Ok(AppType::Codex),
            "gemini" => Ok(AppType::Gemini),
            "opencode" => Ok(AppType::OpenCode),
            "openclaw" => Ok(AppType::OpenClaw),
            "hermes" => Ok(AppType::Hermes),
            other => Err(AppError::localized(
                "unsupported_app",
                format!(": '{other}'。: claude, claude-desktop, codex, gemini, opencode, openclaw, hermes。"),
                format!("Unsupported app id: '{other}'. Allowed: claude, claude-desktop, codex, gemini, opencode, openclaw, hermes."),
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommonConfigSnippets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gemini: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opencode: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openclaw: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hermes: Option<String>,
}

impl CommonConfigSnippets {
    pub fn get(&self, app: &AppType) -> Option<&String> {
        match app {
            AppType::Claude => self.claude.as_ref(),
            AppType::ClaudeDesktop => None,
            AppType::Codex => self.codex.as_ref(),
            AppType::Gemini => self.gemini.as_ref(),
            AppType::OpenCode => self.opencode.as_ref(),
            AppType::OpenClaw => self.openclaw.as_ref(),
            AppType::Hermes => self.hermes.as_ref(),
        }
    }

    pub fn set(&mut self, app: &AppType, snippet: Option<String>) {
        match app {
            AppType::Claude => self.claude = snippet,
            AppType::ClaudeDesktop => {}
            AppType::Codex => self.codex = snippet,
            AppType::Gemini => self.gemini = snippet,
            AppType::OpenCode => self.opencode = snippet,
            AppType::OpenClaw => self.openclaw = snippet,
            AppType::Hermes => self.hermes = snippet,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(flatten)]
    pub apps: HashMap<String, ProviderManager>,
    #[serde(default)]
    pub mcp: McpRoot,
    #[serde(default)]
    pub prompts: PromptRoot,
    #[serde(default)]
    pub skills: SkillStore,
    #[serde(default)]
    pub common_config_snippets: CommonConfigSnippets,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_common_config_snippet: Option<String>,
}

fn default_version() -> u32 {
    2
}

impl Default for MultiAppConfig {
    fn default() -> Self {
        let mut apps = HashMap::new();
        apps.insert("claude".to_string(), ProviderManager::default());
        apps.insert("claude-desktop".to_string(), ProviderManager::default());
        apps.insert("codex".to_string(), ProviderManager::default());
        apps.insert("gemini".to_string(), ProviderManager::default());
        apps.insert("opencode".to_string(), ProviderManager::default());
        apps.insert("openclaw".to_string(), ProviderManager::default());
        apps.insert("hermes".to_string(), ProviderManager::default());

        Self {
            version: 2,
            apps,
            mcp: McpRoot::default(),
            prompts: PromptRoot::default(),
            skills: SkillStore::default(),
            common_config_snippets: CommonConfigSnippets::default(),
            claude_common_config_snippet: None,
        }
    }
}

impl MultiAppConfig {
    pub fn load() -> Result<Self, AppError> {
        let config_path = get_app_config_path();

        if !config_path.exists() {
            log::info!("ConfigureConfigure");
            let config = Self::default_with_auto_import()?;
            config.save()?;
            return Ok(config);
        }

        let content =
            std::fs::read_to_string(&config_path).map_err(|e| AppError::io(&config_path, e))?;

        let value: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| AppError::json(&config_path, e))?;
        let is_v1 = value.as_object().is_some_and(|map| {
            let has_providers = map.get("providers").map(|v| v.is_object()).unwrap_or(false);
            let has_current = map.get("current").map(|v| v.is_string()).unwrap_or(false);
            let has_apps = map.contains_key("apps");
            has_providers && has_current && !has_apps
        });
        if is_v1 {
            return Err(AppError::localized(
                "config.unsupported_v1",
                " v1 Configure。。\n\n: \n1.  v3.2.x \n2.  ~/.agent-switchboard/config.json: \n   {\"version\": 2, \"claude\": {...}, \"codex\": {...}, \"mcp\": {...}}\n\n",
                "Detected legacy v1 config. Runtime auto-migration is no longer supported.\n\nSolutions:\n1. Install v3.2.x for one-time auto-migration\n2. Or manually edit ~/.agent-switchboard/config.json to adjust the top-level structure:\n   {\"version\": 2, \"claude\": {...}, \"codex\": {...}, \"mcp\": {...}}\n\n",
            ));
        }

        let has_skills_in_config = value
            .as_object()
            .is_some_and(|map| map.contains_key("skills"));

        let mut config: Self =
            serde_json::from_value(value).map_err(|e| AppError::json(&config_path, e))?;
        let mut updated = false;

        if !has_skills_in_config {
            let skills_path = get_app_config_dir().join("skills.json");
            if skills_path.exists() {
                match std::fs::read_to_string(&skills_path) {
                    Ok(content) => match serde_json::from_str::<SkillStore>(&content) {
                        Ok(store) => {
                            config.skills = store;
                            updated = true;
                            log::info!(" skills.json  Claude Skills Configure");
                        }
                        Err(e) => {
                            log::warn!("failed to parse legacy skills.json: {e}");
                        }
                    },
                    Err(e) => {
                        log::warn!("failed to read legacy skills.json: {e}");
                    }
                }
            }
        }

        if !config.apps.contains_key("gemini") {
            config
                .apps
                .insert("gemini".to_string(), ProviderManager::default());
            updated = true;
        }

        let migrated = config.migrate_mcp_to_unified()?;
        if migrated {
            log::info!("MCP Configure v3.7.0 Configure...");
            updated = true;
        }

        let imported_prompts = config.maybe_auto_import_prompts_for_existing_config()?;
        if imported_prompts {
            updated = true;
        }

        if let Some(old_claude_snippet) = config.claude_common_config_snippet.take() {
            log::info!(
                "Migrate common config: claude_common_config_snippet -> common_config_snippets.claude"
            );
            config.common_config_snippets.claude = Some(old_claude_snippet);
            updated = true;
        }

        if updated {
            log::info!("Configure MCP  Prompt Configure...");
            config.save()?;
        }

        Ok(config)
    }

    pub fn save(&self) -> Result<(), AppError> {
        let config_path = get_app_config_path();
        if config_path.exists() {
            let backup_path = get_app_config_dir().join("config.json.bak");
            if let Err(e) = copy_file(&config_path, &backup_path) {
                log::warn!(" config.json  .bak failed: {e}");
            }
        }

        write_json_file(&config_path, self)?;
        Ok(())
    }

    pub fn get_manager(&self, app: &AppType) -> Option<&ProviderManager> {
        self.apps.get(app.as_str())
    }

    pub fn get_manager_mut(&mut self, app: &AppType) -> Option<&mut ProviderManager> {
        self.apps.get_mut(app.as_str())
    }

    pub fn ensure_app(&mut self, app: &AppType) {
        if !self.apps.contains_key(app.as_str()) {
            self.apps
                .insert(app.as_str().to_string(), ProviderManager::default());
        }
    }

    pub fn mcp_for(&self, app: &AppType) -> &McpConfig {
        match app {
            AppType::Claude => &self.mcp.claude,
            AppType::ClaudeDesktop => &self.mcp.claude_desktop,
            AppType::Codex => &self.mcp.codex,
            AppType::Gemini => &self.mcp.gemini,
            AppType::OpenCode => &self.mcp.opencode,
            AppType::OpenClaw => &self.mcp.openclaw,
            AppType::Hermes => &self.mcp.hermes,
        }
    }

    pub fn mcp_for_mut(&mut self, app: &AppType) -> &mut McpConfig {
        match app {
            AppType::Claude => &mut self.mcp.claude,
            AppType::ClaudeDesktop => &mut self.mcp.claude_desktop,
            AppType::Codex => &mut self.mcp.codex,
            AppType::Gemini => &mut self.mcp.gemini,
            AppType::OpenCode => &mut self.mcp.opencode,
            AppType::OpenClaw => &mut self.mcp.openclaw,
            AppType::Hermes => &mut self.mcp.hermes,
        }
    }

    fn default_with_auto_import() -> Result<Self, AppError> {
        log::info!("Configure");

        let mut config = Self::default();

        Self::auto_import_prompt_if_exists(&mut config, AppType::Claude)?;
        Self::auto_import_prompt_if_exists(&mut config, AppType::Codex)?;
        Self::auto_import_prompt_if_exists(&mut config, AppType::Gemini)?;
        Self::auto_import_prompt_if_exists(&mut config, AppType::OpenCode)?;
        Self::auto_import_prompt_if_exists(&mut config, AppType::OpenClaw)?;
        Self::auto_import_prompt_if_exists(&mut config, AppType::Hermes)?;

        Ok(config)
    }

    ///
    ///
    fn maybe_auto_import_prompts_for_existing_config(&mut self) -> Result<bool, AppError> {
        if !self.prompts.claude.prompts.is_empty()
            || !self.prompts.claude_desktop.prompts.is_empty()
            || !self.prompts.codex.prompts.is_empty()
            || !self.prompts.gemini.prompts.is_empty()
            || !self.prompts.opencode.prompts.is_empty()
            || !self.prompts.openclaw.prompts.is_empty()
            || !self.prompts.hermes.prompts.is_empty()
        {
            return Ok(false);
        }

        log::info!("Configure Prompt ");

        let mut imported = false;
        for app in [
            AppType::Claude,
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
            AppType::OpenClaw,
            AppType::Hermes,
        ] {
            if Self::auto_import_prompt_if_exists(self, app)? {
                imported = true;
            }
        }

        Ok(imported)
    }

    ///
    fn auto_import_prompt_if_exists(config: &mut Self, app: AppType) -> Result<bool, AppError> {
        let file_path = prompt_file_path(&app)?;

        if !file_path.exists() {
            log::debug!(": {file_path:?}");
            return Ok(false);
        }

        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("failed to read prompt file: {file_path:?}, error: {e}");
                return Ok(false);
            }
        };

        if content.trim().is_empty() {
            log::debug!(": {file_path:?}");
            return Ok(false);
        }

        log::info!(": {file_path:?}");

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(|_| {
                log::warn!("failed to get system time, using 0 as timestamp");
                0
            });

        let id = format!("auto-imported-{timestamp}");
        let prompt = crate::prompt::Prompt {
            id: id.clone(),
            name: format!(
                "Auto-imported Prompt {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M")
            ),
            content,
            description: Some("Automatically imported on first launch".to_string()),
            enabled: true,
            created_at: Some(timestamp),
            updated_at: Some(timestamp),
        };

        let prompts = match app {
            AppType::Claude => &mut config.prompts.claude.prompts,
            AppType::ClaudeDesktop => &mut config.prompts.claude_desktop.prompts,
            AppType::Codex => &mut config.prompts.codex.prompts,
            AppType::Gemini => &mut config.prompts.gemini.prompts,
            AppType::OpenCode => &mut config.prompts.opencode.prompts,
            AppType::OpenClaw => &mut config.prompts.openclaw.prompts,
            AppType::Hermes => &mut config.prompts.hermes.prompts,
        };

        prompts.insert(id, prompt);

        log::info!(": {}", app.as_str());
        Ok(true)
    }

    ///
    pub fn migrate_mcp_to_unified(&mut self) -> Result<bool, AppError> {
        if self.mcp.servers.is_some() {
            log::debug!("MCP Configure");
            return Ok(false);
        }

        log::info!(" MCP Configure v3.7.0 ...");

        let mut unified_servers: HashMap<String, McpServer> = HashMap::new();
        let mut conflicts = Vec::new();

        for app in [
            AppType::Claude,
            AppType::Codex,
            AppType::Gemini,
            AppType::OpenCode,
        ] {
            let old_servers = match app {
                AppType::Claude => &self.mcp.claude.servers,
                AppType::ClaudeDesktop => continue, // Claude Desktop 3P profiles don't use MCP here
                AppType::Codex => &self.mcp.codex.servers,
                AppType::Gemini => &self.mcp.gemini.servers,
                AppType::OpenCode => &self.mcp.opencode.servers,
                AppType::OpenClaw => continue, // OpenClaw MCP is still in development, skip
                AppType::Hermes => continue,   // Hermes didn't exist in v3.6.x, skip
            };

            for (id, entry) in old_servers {
                let enabled = entry
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                if let Some(existing) = unified_servers.get_mut(id) {
                    existing.apps.set_enabled_for(&app, enabled);

                    if existing.server != *entry.get("server").unwrap_or(&serde_json::json!({})) {
                        conflicts.push(format!("MCP '{id}'  {} ConfigureConfigure", app.as_str()));
                    }
                } else {
                    let name = entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(id)
                        .to_string();

                    let server = entry
                        .get("server")
                        .cloned()
                        .unwrap_or(serde_json::json!({}));

                    let description = entry
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let homepage = entry
                        .get("homepage")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let docs = entry
                        .get("docs")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let tags = entry
                        .get("tags")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();

                    let mut apps = McpApps::default();
                    apps.set_enabled_for(&app, enabled);

                    unified_servers.insert(
                        id.clone(),
                        McpServer {
                            id: id.clone(),
                            name,
                            server,
                            apps,
                            description,
                            homepage,
                            docs,
                            tags,
                        },
                    );
                }
            }
        }

        if !conflicts.is_empty() {
            log::warn!("MCP Configure: ");
            for conflict in &conflicts {
                log::warn!("  - {conflict}");
            }
        }

        log::info!(
            "MCP  {} {}",
            unified_servers.len(),
            if !conflicts.is_empty() {
                format!("({} conflicts exist)", conflicts.len())
            } else {
                String::new()
            }
        );

        self.mcp.servers = Some(unified_servers);

        self.mcp.claude = McpConfig::default();
        self.mcp.codex = McpConfig::default();
        self.mcp.gemini = McpConfig::default();

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn app_type_parses_claude_desktop_aliases() {
        assert_eq!(
            "claude-desktop".parse::<AppType>().unwrap(),
            AppType::ClaudeDesktop
        );
        assert_eq!(
            "claude_desktop".parse::<AppType>().unwrap(),
            AppType::ClaudeDesktop
        );
        assert_eq!(
            "claudeDesktop".parse::<AppType>().unwrap(),
            AppType::ClaudeDesktop
        );
        assert_eq!(AppType::ClaudeDesktop.as_str(), "claude-desktop");
    }

    struct TempHome {
        #[allow(dead_code)]
        dir: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
    }

    impl TempHome {
        fn new() -> Self {
            let dir = TempDir::new().expect("failed to create temp home");
            let original_home = env::var("HOME").ok();
            let original_userprofile = env::var("USERPROFILE").ok();
            let original_test_home = env::var("CC_SWITCH_TEST_HOME").ok();

            env::set_var("HOME", dir.path());
            env::set_var("USERPROFILE", dir.path());
            env::set_var("CC_SWITCH_TEST_HOME", dir.path());

            Self {
                dir,
                original_home,
                original_userprofile,
                original_test_home,
            }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            match &self.original_home {
                Some(value) => env::set_var("HOME", value),
                None => env::remove_var("HOME"),
            }

            match &self.original_userprofile {
                Some(value) => env::set_var("USERPROFILE", value),
                None => env::remove_var("USERPROFILE"),
            }

            match &self.original_test_home {
                Some(value) => env::set_var("CC_SWITCH_TEST_HOME", value),
                None => env::remove_var("CC_SWITCH_TEST_HOME"),
            }
        }
    }

    fn write_prompt_file(app: AppType, content: &str) {
        let path = crate::prompt_files::prompt_file_path(&app).expect("prompt path");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, content).expect("write prompt");
    }

    #[test]
    #[serial]
    fn auto_imports_existing_prompt_when_config_missing() {
        let _home = TempHome::new();
        write_prompt_file(AppType::Claude, "# hello");

        let config = MultiAppConfig::load().expect("load config");

        assert_eq!(config.prompts.claude.prompts.len(), 1);
        let prompt = config
            .prompts
            .claude
            .prompts
            .values()
            .next()
            .expect("prompt exists");
        assert!(prompt.enabled);
        assert_eq!(prompt.content, "# hello");

        let config_path = crate::config::get_app_config_path();
        assert!(
            config_path.exists(),
            "auto import should persist config to disk"
        );
    }

    #[test]
    #[serial]
    fn skips_empty_prompt_files_during_import() {
        let _home = TempHome::new();
        write_prompt_file(AppType::Claude, "   \n  ");

        let config = MultiAppConfig::load().expect("load config");
        assert!(
            config.prompts.claude.prompts.is_empty(),
            "empty files must be ignored"
        );
    }

    #[test]
    #[serial]
    fn auto_import_happens_only_once() {
        let _home = TempHome::new();
        write_prompt_file(AppType::Claude, "first version");

        let first = MultiAppConfig::load().expect("load config");
        assert_eq!(first.prompts.claude.prompts.len(), 1);
        let claude_prompt = first
            .prompts
            .claude
            .prompts
            .values()
            .next()
            .expect("prompt exists")
            .content
            .clone();
        assert_eq!(claude_prompt, "first version");

        write_prompt_file(AppType::Claude, "second version");
        let second = MultiAppConfig::load().expect("load config again");

        assert_eq!(second.prompts.claude.prompts.len(), 1);
        let prompt = second
            .prompts
            .claude
            .prompts
            .values()
            .next()
            .expect("prompt exists");
        assert_eq!(
            prompt.content, "first version",
            "should not re-import when config already exists"
        );
    }

    #[test]
    #[serial]
    fn auto_imports_gemini_prompt_on_first_launch() {
        let _home = TempHome::new();
        write_prompt_file(AppType::Gemini, "# Gemini Prompt\n\nTest content");

        let config = MultiAppConfig::load().expect("load config");

        assert_eq!(config.prompts.gemini.prompts.len(), 1);
        let prompt = config
            .prompts
            .gemini
            .prompts
            .values()
            .next()
            .expect("gemini prompt exists");
        assert!(prompt.enabled, "gemini prompt should be enabled");
        assert_eq!(prompt.content, "# Gemini Prompt\n\nTest content");
        assert_eq!(
            prompt.description,
            Some("Automatically imported on first launch".to_string())
        );
    }

    #[test]
    #[serial]
    fn auto_imports_all_three_apps_prompts() {
        let _home = TempHome::new();
        write_prompt_file(AppType::Claude, "# Claude prompt");
        write_prompt_file(AppType::Codex, "# Codex prompt");
        write_prompt_file(AppType::Gemini, "# Gemini prompt");

        let config = MultiAppConfig::load().expect("load config");

        assert_eq!(config.prompts.claude.prompts.len(), 1);
        assert_eq!(config.prompts.codex.prompts.len(), 1);
        assert_eq!(config.prompts.gemini.prompts.len(), 1);

        assert!(
            config
                .prompts
                .claude
                .prompts
                .values()
                .next()
                .unwrap()
                .enabled
        );
        assert!(
            config
                .prompts
                .codex
                .prompts
                .values()
                .next()
                .unwrap()
                .enabled
        );
        assert!(
            config
                .prompts
                .gemini
                .prompts
                .values()
                .next()
                .unwrap()
                .enabled
        );
    }
}
