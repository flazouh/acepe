import type { ProviderBrand } from "@acepe/ui";

export type Theme = "light" | "dark";

type ProviderBrandIconPaths = {
	readonly light: string;
	readonly dark: string;
};

const PROVIDER_BRAND_ICON_PATHS: Record<ProviderBrand, ProviderBrandIconPaths> = {
	"claude-code": {
		light: "/svgs/agents/claude/claude-icon-light.svg",
		dark: "/svgs/agents/claude/claude-icon-dark.svg",
	},
	codex: {
		light: "/svgs/agents/codex/codex-icon-light.svg",
		dark: "/svgs/agents/codex/codex-icon-dark.svg",
	},
	cursor: {
		light: "/svgs/agents/cursor/cursor-icon-light.svg",
		dark: "/svgs/agents/cursor/cursor-icon-dark.svg",
	},
	copilot: {
		light: "/svgs/agents/copilot/copilot-icon-light.svg",
		dark: "/svgs/agents/copilot/copilot-icon-dark.svg",
	},
	opencode: {
		light: "/svgs/agents/opencode/opencode-logo-light.svg",
		dark: "/svgs/agents/opencode/opencode-logo-dark.svg",
	},
	custom: {
		light: "/svgs/agents/custom/custom-icon.svg",
		dark: "/svgs/agents/custom/custom-icon.svg",
	},
};

export function getProviderBrandIconSrc(
	providerBrand: ProviderBrand | null | undefined,
	theme: Theme
): string {
	return PROVIDER_BRAND_ICON_PATHS[providerBrand ?? "custom"][theme];
}
