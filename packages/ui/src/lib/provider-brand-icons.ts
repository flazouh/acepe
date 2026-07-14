import type { ProviderBrand } from "./provider-brand.js";
import type { UpstreamProviderBrand } from "./upstream-provider-brand.js";

type ThemeIconPair = {
	readonly light: string;
	readonly dark: string;
};

type IconProviderBrand = Exclude<ProviderBrand, "custom">;

export const ANTHROPIC_ICON_LIGHT_SRC =
	"data:image/svg+xml,%3Csvg%20fill%3D%22%23000000%22%20role%3D%22img%22%20viewBox%3D%220%200%2024%2024%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctitle%3EAnthropic%3C%2Ftitle%3E%3Cpath%20d%3D%22M17.3041%203.541h-3.6718l6.696%2016.918H24Zm-10.6082%200L0%2020.459h3.7442l1.3693-3.5527h7.0052l1.3693%203.5528h3.7442L10.5363%203.5409Zm-.3712%2010.2232%202.2914-5.9456%202.2914%205.9456Z%22%2F%3E%3C%2Fsvg%3E";
export const ANTHROPIC_ICON_DARK_SRC =
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
};

const UPSTREAM_PROVIDER_ICONS: Partial<Record<Exclude<UpstreamProviderBrand, "custom">, ThemeIconPair>> = {
	anthropic: {
		light: ANTHROPIC_ICON_LIGHT_SRC,
		dark: ANTHROPIC_ICON_DARK_SRC,
	},
	githubCopilot: {
		light: "/svgs/icons/copilot_light.svg",
		dark: "/svgs/icons/copilot.svg",
	},
	openAi: {
		light: "/svgs/agents/codex/openai-icon.svg",
		dark: "/svgs/agents/codex/openai-icon.svg",
	},
};

export function getProviderBrandIconSrc(
	providerBrand: ProviderBrand | null | undefined,
	theme: "light" | "dark",
): string | null {
	if (!providerBrand || providerBrand === "custom") {
		return null;
	}

	return PROVIDER_BRAND_ICONS[providerBrand][theme];
}

export function getUpstreamProviderBrandIconSrc(
	providerBrand: UpstreamProviderBrand | null | undefined,
	theme: "light" | "dark",
): string | null {
	if (!providerBrand || providerBrand === "custom") {
		return null;
	}

	return UPSTREAM_PROVIDER_ICONS[providerBrand]?.[theme] ?? null;
}
