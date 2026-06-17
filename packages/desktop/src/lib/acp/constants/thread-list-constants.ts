/**
 * Constants for thread list operations.
 */

import type { ProviderBrand } from "@acepe/ui";

type ThemeIconPair = {
	readonly light: string;
	readonly dark: string;
};

type IconProviderBrand = Exclude<ProviderBrand, "custom">;

const PROVIDER_BRAND_ICONS: Record<IconProviderBrand, ThemeIconPair> = {
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
		light: "/svgs/agents/codex/codex-app-icon.png",
		dark: "/svgs/agents/codex/codex-app-icon.png",
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

/**
 * Base CSS class for agent icons.
 */
export const AGENT_ICON_BASE_CLASS = "block h-4 w-4 shrink-0 mt-0.5";

/** Codex app icon PNG needs superellipse clipping at small sizes. */
export const CODEX_APP_ICON_IMG_CLASS = "rounded-[22%] object-contain";

export function isCodexProviderBrand(
	providerBrand: ProviderBrand | null | undefined
): providerBrand is "codex" {
	return providerBrand === "codex";
}

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
