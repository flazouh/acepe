import { describe, expect, it } from "vitest";

import { resolveResolvableToolbarModelId } from "./resolve-resolvable-toolbar-model-id.js";

describe("resolveResolvableToolbarModelId", () => {
	it("keeps the explicit provisional pick before capabilities hydrate during connecting", () => {
		expect(
			resolveResolvableToolbarModelId({
				provisionalModelId: "claude-sonnet-4-6",
				resolvedToolbarModelId: null,
			})
		).toBe("claude-sonnet-4-6");
	});

	it("falls back to the resolved toolbar model when no provisional pick exists", () => {
		expect(
			resolveResolvableToolbarModelId({
				provisionalModelId: null,
				resolvedToolbarModelId: "claude-opus-4-6",
			})
		).toBe("claude-opus-4-6");
	});
});
