use serde::{Deserialize, Serialize};

/// User setting keys for the app_settings table.
/// These are the allowed keys for save_user_setting/get_user_setting commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum UserSettingKey {
    /// User's preferred theme (light, dark, system)
    UserTheme,
    /// User's preferred locale/language
    UserLocale,
    /// Workspace panel layout state (JSON)
    WorkspaceState,
    /// Custom keybindings (JSON map of command -> key)
    CustomKeybindings,
    /// Streaming text animation style (none, fade, glow, typewriter)
    StreamingAnimation,
    /// Webview zoom level (stored as float string, e.g., "1.0", "1.2")
    ZoomLevel,
    /// Default models per agent per mode (JSON map)
    AgentDefaultModels,
    /// Favorite models per agent (JSON map)
    AgentFavoriteModels,
    /// Cached available models per agent (JSON map)
    AgentAvailableModelsCache,
    /// Cached available models display groups per agent (JSON map)
    AgentAvailableModelsDisplayCache,
    /// Cached provider metadata per agent (JSON map)
    AgentProviderMetadataCache,
    /// Cached available modes per agent (JSON map)
    AgentAvailableModesCache,
    /// Per-session model memory (JSON map)
    SessionModelPerMode,
    /// Global PR generation preferences (JSON object)
    PrGenerationPreferences,
    /// Command palette recent items (JSON array)
    CommandPaletteRecentItems,
    /// OpenCode favorite models (JSON array)
    FavoriteModels,
    /// OpenCode recent models (JSON array)
    RecentModels,
    /// Whether user has seen the splash screen (boolean string "true"/"false")
    HasSeenSplash,
    /// Last app version the user has seen the changelog for
    LastSeenVersion,
    /// Whether user has completed first-run onboarding
    HasCompletedOnboarding,
    /// Selected agent IDs for UI visibility/filtering (JSON array)
    SelectedAgentIds,
    /// Persisted custom agent configurations (JSON array)
    CustomAgentConfigs,
    /// Persisted per-agent environment overrides (JSON object)
    AgentEnvOverrides,
    /// Whether opening review should use full-screen overlay (boolean string "true"/"false")
    ReviewPreferFullscreen,
    /// Use worktrees by default for new sessions (boolean)
    #[serde(rename = "worktree_global_default_enabled")]
    WorktreeGlobalDefault,
    /// Workspace trust decisions for setup commands (JSON map: path key -> { trusted, commands })
    WorktreeTrust,
    /// Whether thinking blocks in chat are collapsed by default (boolean)
    ChatThinkingBlockCollapsedByDefault,
    /// Whether plans render inline in chat vs sidebar panel (boolean)
    PlanInlineMode,
    /// Per-category notification preferences (JSON object)
    #[serde(rename = "notification-preferences")]
    NotificationPreferences,
    /// Selected voice model ID (e.g. "small.en")
    VoiceModel,
    /// Preferred voice transcription language code (e.g. "en" or "auto")
    VoiceLanguage,
    /// Whether voice dictation is enabled (boolean)
    VoiceEnabled,
    /// Agent ID used for AI-generated commit messages and PR descriptions
    GitTextGenerationAgent,
    /// Preferred merge strategy for PRs (e.g., "squash", "merge", "rebase")
    #[serde(rename = "git_merge_strategy_preference")]
    GitMergeStrategyPreference,
    /// Set of dismissed tooltip keys (JSON array of string keys)
    DismissedTooltips,
    /// Whether the attention queue panel is shown in the sidebar (boolean)
    AttentionQueueEnabled,
    /// User's preferred default agent ID for new sessions
    DefaultAgentId,
}

impl UserSettingKey {
    /// Get the string key for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            UserSettingKey::UserTheme => "user_theme",
            UserSettingKey::UserLocale => "user_locale",
            UserSettingKey::WorkspaceState => "workspace_state",
            UserSettingKey::CustomKeybindings => "custom_keybindings",
            UserSettingKey::StreamingAnimation => "streaming_animation",
            UserSettingKey::ZoomLevel => "zoom_level",
            UserSettingKey::AgentDefaultModels => "agent_default_models",
            UserSettingKey::AgentFavoriteModels => "agent_favorite_models",
            UserSettingKey::AgentAvailableModelsCache => "agent_available_models_cache",
            UserSettingKey::AgentAvailableModelsDisplayCache => {
                "agent_available_models_display_cache"
            }
            UserSettingKey::AgentProviderMetadataCache => "agent_provider_metadata_cache",
            UserSettingKey::AgentAvailableModesCache => "agent_available_modes_cache",
            UserSettingKey::SessionModelPerMode => "session_model_per_mode",
            UserSettingKey::PrGenerationPreferences => "pr_generation_preferences",
            UserSettingKey::CommandPaletteRecentItems => "command_palette_recent_items",
            UserSettingKey::FavoriteModels => "favorite_models",
            UserSettingKey::RecentModels => "recent_models",
            UserSettingKey::HasSeenSplash => "has_seen_splash",
            UserSettingKey::LastSeenVersion => "last_seen_version",
            UserSettingKey::HasCompletedOnboarding => "has_completed_onboarding",
            UserSettingKey::SelectedAgentIds => "selected_agent_ids",
            UserSettingKey::CustomAgentConfigs => "custom_agent_configs",
            UserSettingKey::AgentEnvOverrides => "agent_env_overrides",
            UserSettingKey::ReviewPreferFullscreen => "review_prefer_fullscreen",
            UserSettingKey::WorktreeGlobalDefault => "worktree_global_default_enabled",
            UserSettingKey::WorktreeTrust => "worktree_trust",
            UserSettingKey::ChatThinkingBlockCollapsedByDefault => {
                "chat_thinking_block_collapsed_by_default"
            }
            UserSettingKey::PlanInlineMode => "plan_inline_mode",
            UserSettingKey::NotificationPreferences => "notification-preferences",
            UserSettingKey::VoiceModel => "voice_model",
            UserSettingKey::VoiceLanguage => "voice_language",
            UserSettingKey::VoiceEnabled => "voice_enabled",
            UserSettingKey::GitTextGenerationAgent => "git_text_generation_agent",
            UserSettingKey::GitMergeStrategyPreference => "git_merge_strategy_preference",
            UserSettingKey::DismissedTooltips => "dismissed_tooltips",
            UserSettingKey::AttentionQueueEnabled => "attention_queue_enabled",
            UserSettingKey::DefaultAgentId => "default_agent_id",
        }
    }
}

impl std::fmt::Display for UserSettingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Custom keybindings stored as a map of command -> key
/// Example: { "selector.agent.toggle": "$mod+o" }
pub type CustomKeybindings = std::collections::HashMap<String, String>;

#[cfg(test)]
mod tests {
    use super::UserSettingKey;

    #[test]
    fn user_setting_key_accepts_additional_keys() {
        let keys = [
            "agent_default_models",
            "agent_favorite_models",
            "agent_available_models_cache",
            "agent_available_models_display_cache",
            "agent_provider_metadata_cache",
            "agent_available_modes_cache",
            "session_model_per_mode",
            "pr_generation_preferences",
            "command_palette_recent_items",
            "favorite_models",
            "recent_models",
            "has_completed_onboarding",
            "selected_agent_ids",
            "custom_agent_configs",
            "agent_env_overrides",
            "chat_thinking_block_collapsed_by_default",
            "plan_inline_mode",
            "notification-preferences",
            "voice_model",
            "voice_language",
            "voice_enabled",
            "git_text_generation_agent",
            "dismissed_tooltips",
            "attention_queue_enabled",
            "default_agent_id",
        ];

        for key in keys {
            let json = format!("\"{}\"", key);
            let parsed: UserSettingKey =
                serde_json::from_str(&json).expect("expected user setting key to deserialize");
            assert_eq!(parsed.to_string(), key);
        }
    }
}
