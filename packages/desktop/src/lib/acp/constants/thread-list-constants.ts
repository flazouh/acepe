/**
 * Constants for thread list operations.
 */

import type { ProviderBrand } from "@acepe/ui";

type ThemeIconPair = {
	readonly light: string;
	readonly dark: string;
};

type IconProviderBrand = Exclude<ProviderBrand, "custom">;

const BUILT_IN_PROVIDER_BRANDS = [
	"claude-code",
	"copilot",
	"cursor",
	"opencode",
	"codex",
] as const satisfies readonly ProviderBrand[];

const ANTHROPIC_ICON_LIGHT_SRC =
	"data:image/svg+xml,%3Csvg%20fill%3D%22%23000000%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctitle%3EAnthropic%3C%2Ftitle%3E%3Cpath%20d%3D%22M17.3041%203.541h-3.6718l6.696%2016.918H24Zm-10.6082%200L0%2020.459h3.7442l1.3693-3.5527h7.0052l1.3693%203.5528h3.7442L10.5363%203.5409Zm-.3712%2010.2232%202.2914-5.9456%202.2914%205.9456Z%22%2F%3E%3C%2Fsvg%3E";
const ANTHROPIC_ICON_DARK_SRC =
	"data:image/svg+xml,%3Csvg%20fill%3D%22%23ffffff%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctitle%3EAnthropic%3C%2Ftitle%3E%3Cpath%20d%3D%22M17.3041%203.541h-3.6718l6.696%2016.918H24Zm-10.6082%200L0%2020.459h3.7442l1.3693-3.5527h7.0052l1.3693%203.5528h3.7442L10.5363%203.5409Zm-.3712%2010.2232%202.2914-5.9456%202.2914%205.9456Z%22%2F%3E%3C%2Fsvg%3E";

const PROVIDER_BRAND_ICONS: Record<IconProviderBrand, ThemeIconPair> = {
	anthropic: {
		light: ANTHROPIC_ICON_LIGHT_SRC,
		dark: ANTHROPIC_ICON_DARK_SRC,
	},
	opencode: {
		light: "/svgs/agents/opencode/opencode-logo-light.svg",
		dark: "/svgs/agents/opencode/opencode-logo-dark.svg",
	},
	"claude-code": {
		light: "/svgs/agents/claude/claude-icon-light.svg",
		dark: "/svgs/agents/claude/claude-icon-dark.svg",
	},
	copilot: {
		light: "/svgs/icons/copilot_light.svg",
		dark: "/svgs/icons/copilot.svg",
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
 * Get provider icon path for the current theme.
 * Keys match app theme: "light" = asset for light theme, "dark" = asset for dark theme.
 */
export function getProviderBrandIcon(
	providerBrand: ProviderBrand | null | undefined,
	theme: "light" | "dark"
): string | null {
	if (!providerBrand || providerBrand === "custom") {
		return null;
	}

	return PROVIDER_BRAND_ICONS[providerBrand][theme];
}

export function getBuiltInProviderBrandForAgentId(
	agentId: string | null | undefined
): ProviderBrand | null {
	if (agentId === null || agentId === undefined) {
		return null;
	}

	const matchingBrand = BUILT_IN_PROVIDER_BRANDS.find((brand) => brand === agentId);
	return matchingBrand ?? null;
}

export function resolveAgentIconProviderBrand(input: {
	readonly agentId: string | null | undefined;
	readonly explicitProviderBrand: ProviderBrand | null | undefined;
	readonly storeProviderBrand: ProviderBrand | null | undefined;
}): ProviderBrand | null {
	if (input.explicitProviderBrand && input.explicitProviderBrand !== "custom") {
		return input.explicitProviderBrand;
	}

	if (input.storeProviderBrand && input.storeProviderBrand !== "custom") {
		return input.storeProviderBrand;
	}

	return getBuiltInProviderBrandForAgentId(input.agentId);
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
 * Fallback text for unknown time.
 */
export const UNKNOWN_TIME_TEXT = "Unknown";
