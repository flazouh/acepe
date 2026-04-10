import { getProviderDisplayName, resolveProviderBrand } from "@acepe/ui";
import { describe, expect, it } from "vitest";

describe("provider mark resolver", () => {
	it("maps claude-family model names to Anthropic", () => {
		expect(resolveProviderBrand("claude-sonnet-4")).toBe("anthropic");
		expect(getProviderDisplayName("claude-sonnet-4")).toBe("Anthropic");
	});

	it("maps gpt and codex families to OpenAI", () => {
		expect(resolveProviderBrand("gpt-5.3-codex")).toBe("openai");
		expect(resolveProviderBrand("openai:gpt-4.1")).toBe("openai");
		expect(getProviderDisplayName("gpt-5.3-codex")).toBe("OpenAI");
	});

	it("keeps unknown providers generic", () => {
		expect(resolveProviderBrand("opus")).toBe("other");
		expect(getProviderDisplayName("opus")).toBe("Other");
	});
});
