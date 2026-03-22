/**
 * Constants for thread list operations.
 */

/**
 * Agent icon paths mapping with light/dark variants.
 */
export const AGENT_ICONS: Record<string, { light: string; dark: string }> = {
	opencode: {
		light: "/svgs/agents/opencode/opencode-logo-light.svg",
		dark: "/svgs/agents/opencode/opencode-logo-dark.svg",
	},
	"claude-code": {
		light: "/svgs/agents/claude/claude-icon-light.svg",
		dark: "/svgs/agents/claude/claude-icon-dark.svg",
	},
	cursor: {
		light: "/svgs/agents/cursor/cursor-icon-light.svg",
		dark: "/svgs/agents/cursor/cursor-icon-dark.svg",
	},
	codex: {
		light: "/svgs/agents/codex/codex-icon-light.svg",
		dark: "/svgs/agents/codex/codex-icon-dark.svg",
	},
} as const;

/**
 * Default agent icon paths.
 * Uses Claude Code as default since most historical sessions are from Claude CLI.
 */
export const DEFAULT_AGENT_ICON = {
	light: "/svgs/agents/claude/claude-icon-light.svg",
	dark: "/svgs/agents/claude/claude-icon-dark.svg",
};

/**
 * Get agent icon path for the current theme.
 * Keys match app theme: "light" = asset for light theme, "dark" = asset for dark theme.
 * If agentId is null/undefined, logs a warning and returns default icon.
 */
export function getAgentIcon(agentId: string | null | undefined, theme: "light" | "dark"): string {
	if (!agentId) {
		console.warn(
			"[getAgentIcon] No agentId provided - this indicates a bug in agent context propagation"
		);
		return DEFAULT_AGENT_ICON[theme];
	}
	const icons = AGENT_ICONS[agentId] ?? DEFAULT_AGENT_ICON;
	return icons[theme];
}

/**
 * Base CSS class for agent icons.
 */
export const AGENT_ICON_BASE_CLASS = "block h-4 w-4 shrink-0 mt-0.5";

/**
 * Time group labels.
 */
export const TIME_GROUPS = {
	TODAY: "Today",
	YESTERDAY: "Yesterday",
	THIS_WEEK: "This week",
	THIS_MONTH: "This month",
	OLDER: "Older",
} as const;

/**
 * Time group order for display.
 */
export const TIME_GROUP_ORDER = [
	TIME_GROUPS.TODAY,
	TIME_GROUPS.YESTERDAY,
	TIME_GROUPS.THIS_WEEK,
	TIME_GROUPS.THIS_MONTH,
	TIME_GROUPS.OLDER,
] as const;

/**
 * Time formatting constants (in milliseconds).
 */
export const TIME_CONSTANTS = {
	MINUTE: 60_000,
	HOUR: 3_600_000,
	DAY: 86_400_000,
	WEEK: 604_800_000,
	MONTH: 2_592_000_000, // 30 days
} as const;

/**
 * Default agent ID for historical conversations.
 * Uses Claude Code as default since most historical sessions are from Claude CLI.
 */
export const DEFAULT_HISTORICAL_AGENT_ID = "claude-code";

/**
 * Fallback text for unknown time.
 */
export const UNKNOWN_TIME_TEXT = "Unknown";
