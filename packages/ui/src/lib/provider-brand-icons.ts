import type { ProviderBrand } from "./provider-brand.js";

type ThemeIconPair = {
	readonly light: string;
	readonly dark: string;
};

type IconProviderBrand = Exclude<ProviderBrand, "custom">;

/** Codex uses the app icon asset, not the generic OpenAI mark SVGs. */
export const CODEX_APP_ICON_SRC = "/svgs/agents/codex/codex-app-icon.png";

/** iOS-style superellipse clip for square app-icon PNGs at small sizes. */
export const CODEX_APP_ICON_IMG_CLASS = "rounded-[22%] object-contain";

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
		light: CODEX_APP_ICON_SRC,
		dark: CODEX_APP_ICON_SRC,
	},
} as const;

export function getProviderBrandIconSrc(
	providerBrand: ProviderBrand | null | undefined,
	theme: "light" | "dark"
): string | null {
	if (!providerBrand || providerBrand === "custom") {
		return null;
	}

	return PROVIDER_BRAND_ICONS[providerBrand][theme];
}

export function isCodexProviderBrand(
	providerBrand: ProviderBrand | null | undefined
): providerBrand is "codex" {
	return providerBrand === "codex";
}
