import * as Schema from "effect/Schema"

import { SettingsId } from "./ids.ts"

export const USER_SETTING_KEYS = [
	"user_theme",
	"ui_theme_family",
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

// Environment variable names an agent override must never set. Each one can
// turn a plain "give the child my API key" setting into arbitrary code
// execution inside the spawned agent: PATH and the DYLD_/LD_ family redirect
// which binary or library actually loads, and the rest are interpreter
// pre-run hooks (NODE_OPTIONS --require, BASH_ENV, PERL5OPT, ...). The
// settings dialog refuses them at input time, and the server refuses them
// again at the spawn seam, because a stored setting can predate the dialog's
// own rules or be written by anything that can reach the settings RPC.
export const BLOCKED_AGENT_ENV_NAMES: ReadonlyArray<string> = [
	"PATH",
	"_JAVA_OPTIONS",
	"PERL5OPT",
	"NODE_OPTIONS",
	"PYTHONSTARTUP",
	"RUBYOPT",
	"BASH_ENV",
	"ENV",
	"PROMPT_COMMAND",
]

export const BLOCKED_AGENT_ENV_PREFIXES: ReadonlyArray<string> = ["DYLD_", "LD_"]

export const isBlockedAgentEnvName = (name: string): boolean =>
	BLOCKED_AGENT_ENV_NAMES.includes(name) ||
	BLOCKED_AGENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))

// One agent's overrides, and then the whole map keyed by agent id. The agent
// id here is the same string the provider adapters call a ProviderId
// ("claude-code", "codex", "cursor", "copilot", "opencode", "grok-build"), which is what
// the settings dialog writes.
export const AgentEnvOverrides = Schema.Record(Schema.String, Schema.String)
export type AgentEnvOverrides = typeof AgentEnvOverrides.Type

export const AgentEnvOverridesByAgent = Schema.Record(Schema.String, AgentEnvOverrides)
export type AgentEnvOverridesByAgent = typeof AgentEnvOverridesByAgent.Type

export const AGENT_ENV_OVERRIDES_SETTING_KEY: UserSettingKey = "agent_env_overrides"
