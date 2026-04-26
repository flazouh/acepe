import { getProviderDisplayName, resolveProviderBrand } from "@acepe/ui";
import { describe, expect, it } from "vitest";

describe("provider mark resolver", () => {
	it("maps claude-family model names to Anthropic", () => {
		expect(resolveProviderBrand("claude-sonnet-4")).toBe("anthropic");
		expect(getProviderDisplayName("claude-sonnet-4")).toBe("Anthropic");
	});

	it("maps Claude short alias IDs to Anthropic", () => {
		expect(resolveProviderBrand("opus")).toBe("anthropic");
		expect(resolveProviderBrand("sonnet")).toBe("anthropic");
		expect(resolveProviderBrand("haiku")).toBe("anthropic");
	});

	it("maps Sonnet[1m] providerSource to Anthropic", () => {
		// Claude Code CLI persists display strings like "sonnet[1m]" in settings. When
		// Acepe reads this it stores the raw string as the model_id, so the providerSource
		// becomes "{displayName} {model_id}" — both may contain the bracket suffix.
		expect(resolveProviderBrand("Sonnet[1m] sonnet")).toBe("anthropic");
		expect(resolveProviderBrand("Sonnet[1m] sonnet[1m]")).toBe("anthropic");
		expect(resolveProviderBrand("Opus[1m] opus[1m]")).toBe("anthropic");
		// SDK-style IDs like "claude-sonnet-4-6-1m" are caught by the "claude" check.
		expect(resolveProviderBrand("Sonnet[1m] claude-sonnet-4-6-1m")).toBe("anthropic");
	});

	it("maps gpt and codex families to OpenAI", () => {
		expect(resolveProviderBrand("gpt-5.3-codex")).toBe("openai");
		expect(resolveProviderBrand("openai:gpt-4.1")).toBe("openai");
		expect(getProviderDisplayName("gpt-5.3-codex")).toBe("OpenAI");
	});

	it("keeps unknown providers generic", () => {
		expect(resolveProviderBrand("some-unknown-model")).toBe("other");
		expect(getProviderDisplayName("some-unknown-model")).toBe("Other");
	});
});
