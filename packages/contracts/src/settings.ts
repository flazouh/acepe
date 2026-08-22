import * as Schema from "effect/Schema"

import { SettingsId } from "./ids.ts"

export const USER_SETTING_KEYS = [
	"user_theme",
	"loading_indicator_color",
	"workspace_state",
	"custom_keybindings",
	"zoom_level",
	"agent_default_models",
	"agent_favorite_models",
	"agent_model_provider",
	"agent_available_models_cache",
	"agent_available_models_display_cache",
	"agent_provider_metadata_cache",
	"agent_available_modes_cache",
	"session_model_per_mode",
	"pr_generation_preferences",
	"command_palette_recent_items",
	"favorite_models",
	"recent_models",
	"has_seen_splash",
	"has_completed_onboarding",
	"selected_agent_ids",
	"custom_agent_configs",
	"agent_env_overrides",
	"worktree_global_default_enabled",
	"worktree_project_defaults",
	"worktree_trust",
	"chat_thinking_block_collapsed_by_default",
	"chat_streaming_reveal_mode",
	"plan_inline_mode",
	"review_prefer_fullscreen",
	"notification-preferences",
	"voice_model",
	"voice_language",
	"voice_enabled",
	"git_text_generation_agent",
	"git_merge_strategy_preference",
	"dismissed_tooltips",
	"analytics_opt_out",
	"default_agent_id",
	"ui_font_size",
	"code_font_size",
] as const

export const UserSettingKey = Schema.Literals(USER_SETTING_KEYS)
export type UserSettingKey = typeof UserSettingKey.Type

export const SettingsValue = Schema.String
export type SettingsValue = typeof SettingsValue.Type

export const APP_SETTINGS_ID: SettingsId = SettingsId.make("app")
