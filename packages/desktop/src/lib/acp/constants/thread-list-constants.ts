/**
 * Constants for thread list operations.
 */

import { hugeiconsIconDataUri, type HugeiconsIconName } from "@acepe/ui/icons";
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

const PROVIDER_BRAND_ICON_NAMES: Record<IconProviderBrand, HugeiconsIconName> = {
	anthropic: "brain",
	opencode: "terminal",
	"claude-code": "robot",
	copilot: "sparkle",
	cursor: "code",
	codex: "code",
};

function createThemeIconPair(iconName: HugeiconsIconName): ThemeIconPair {
	return {
		light: hugeiconsIconDataUri(iconName, "#27272a"),
		dark: hugeiconsIconDataUri(iconName, "#fafafa"),
	};
}

const PROVIDER_BRAND_ICONS: Record<IconProviderBrand, ThemeIconPair> = {
	anthropic: createThemeIconPair(PROVIDER_BRAND_ICON_NAMES.anthropic),
	opencode: createThemeIconPair(PROVIDER_BRAND_ICON_NAMES.opencode),
	"claude-code": createThemeIconPair(PROVIDER_BRAND_ICON_NAMES["claude-code"]),
	copilot: createThemeIconPair(PROVIDER_BRAND_ICON_NAMES.copilot),
	cursor: createThemeIconPair(PROVIDER_BRAND_ICON_NAMES.cursor),
	codex: createThemeIconPair(PROVIDER_BRAND_ICON_NAMES.codex),
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
