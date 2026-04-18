import { describe, expect, it } from "vitest";

import { toAgentToolKind } from "../tool-kind-to-agent-tool-kind.js";

/**
 * Contract: SQL and unclassified tool kinds map to distinct agent-panel discriminators,
 * not generic "other", so routers and registries can render intentionally.
 */
describe("semantic tool rendering contract", () => {
	it("exposes sql and unclassified as first-class agent tool kinds", () => {
		expect(toAgentToolKind("sql")).toBe("sql");
		expect(toAgentToolKind("unclassified")).toBe("unclassified");
	});

	it("still maps unknown auxiliary kinds to other where the UI union has no dedicated variant", () => {
		expect(toAgentToolKind("todo")).toBe("other");
		expect(toAgentToolKind("question")).toBe("other");
	});
});
