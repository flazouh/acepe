/**
 * Presentation brand for an upstream provider inside a multiplexed catalog
 * (e.g. OpenCode routing to Anthropic, GitHub Copilot, OpenRouter, …).
 *
 * Deliberately separate from the agent-level `ProviderBrand`: the outer agent
 * (OpenCode) keeps its own identity while individual model groups surface the
 * upstream provider that actually serves them. Values match the canonical
 * Rust `UpstreamProviderBrand` serialization exactly, so the desktop adapter is
 * a pure pass-through with no label or model-id parsing.
 */
export const UPSTREAM_PROVIDER_BRANDS = [
	"anthropic",
	"githubCopilot",
	"openRouter",
	"openAi",
	"xai",
	"custom",
] as const;

export type UpstreamProviderBrand = (typeof UPSTREAM_PROVIDER_BRANDS)[number];

const UPSTREAM_PROVIDER_DISPLAY_NAMES: Record<UpstreamProviderBrand, string> = {
	anthropic: "Anthropic",
	githubCopilot: "GitHub Copilot",
	openRouter: "OpenRouter",
	openAi: "OpenAI",
	xai: "xAI",
	custom: "Custom",
};

export function getUpstreamProviderBrandDisplayName(brand: UpstreamProviderBrand): string {
	return UPSTREAM_PROVIDER_DISPLAY_NAMES[brand];
}
