import {
	hugeiconsIconDataUri,
	type HugeiconsIconName,
} from "../components/icons/index.js";
import type { ProviderBrand } from "./provider-brand.js";
import type { UpstreamProviderBrand } from "./upstream-provider-brand.js";

type ThemeIconPair = {
	readonly light: string;
	readonly dark: string;
};

type IconProviderBrand = Exclude<ProviderBrand, "custom">;

const PROVIDER_BRAND_ICON_NAMES: Record<IconProviderBrand, HugeiconsIconName> = {
	anthropic: "brain",
	opencode: "terminal",
	"claude-code": "robot",
	copilot: "sparkle",
	cursor: "code",
	codex: "code",
};

const UPSTREAM_PROVIDER_ICON_NAMES: Record<Exclude<UpstreamProviderBrand, "custom">, HugeiconsIconName> = {
	anthropic: "brain",
	githubCopilot: "sparkle",
	openRouter: "branch",
	openAi: "code",
	xai: "sparkles",
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

	return hugeiconsIconDataUri(
		UPSTREAM_PROVIDER_ICON_NAMES[providerBrand],
		theme === "dark" ? "#fafafa" : "#27272a",
	);
}
