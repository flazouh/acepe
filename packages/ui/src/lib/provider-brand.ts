export const PROVIDER_BRANDS = [
	"anthropic",
	"openai",
	"google",
	"opencode",
	"cursor",
	"default",
	"other",
] as const;

export type ProviderBrand = (typeof PROVIDER_BRANDS)[number];

const PROVIDER_DISPLAY_NAMES: Record<ProviderBrand, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	opencode: "OpenCode",
	cursor: "Cursor",
	default: "Default",
	other: "Other",
};

function normalizeProviderSource(source: string | null | undefined): string {
	return source?.trim().toLowerCase() ?? "";
}

function isOpenAiReasoningFamily(value: string): boolean {
	return /(^|[^a-z0-9])o(?:1|3|4)(?:-[a-z0-9]+)?(?=$|[^a-z0-9])/.test(value);
}

function isClaudeFamily(value: string): boolean {
	// Claude-family model short names used as standalone IDs by Claude Code
	return /(^|[^a-z])(sonnet|haiku|opus)([^a-z]|$)/.test(value);
}

export function resolveProviderBrand(source: string | null | undefined): ProviderBrand {
	const normalized = normalizeProviderSource(source);

	if (!normalized) {
		return "other";
	}

	if (normalized.includes("anthropic") || normalized.includes("claude") || isClaudeFamily(normalized)) {
		return "anthropic";
	}

	if (
		normalized.includes("openai") ||
		normalized.includes("chatgpt") ||
		normalized.includes("gpt") ||
		normalized.includes("codex") ||
		isOpenAiReasoningFamily(normalized)
	) {
		return "openai";
	}

	if (normalized.includes("google") || normalized.includes("gemini")) {
		return "google";
	}

	if (normalized.includes("opencode")) {
		return "opencode";
	}

	if (normalized.includes("cursor") || normalized.includes("composer")) {
		return "cursor";
	}

	if (normalized === "default" || normalized === "auto") {
		return "default";
	}

	return "other";
}

export function getProviderDisplayName(source: string | null | undefined): string {
	return PROVIDER_DISPLAY_NAMES[resolveProviderBrand(source)];
}
