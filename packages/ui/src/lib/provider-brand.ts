export const PROVIDER_BRANDS = [
	"anthropic",
	"claude-code",
	"copilot",
	"cursor",
	"opencode",
	"codex",
	"custom",
] as const;

export type ProviderBrand = (typeof PROVIDER_BRANDS)[number];

const PROVIDER_DISPLAY_NAMES: Record<ProviderBrand, string> = {
	anthropic: "Anthropic",
	"claude-code": "Claude Code",
	copilot: "Copilot",
	cursor: "Cursor",
	opencode: "OpenCode",
	codex: "Codex",
	custom: "Custom",
};

export function getProviderBrandDisplayName(brand: ProviderBrand): string {
	return PROVIDER_DISPLAY_NAMES[brand];
}
