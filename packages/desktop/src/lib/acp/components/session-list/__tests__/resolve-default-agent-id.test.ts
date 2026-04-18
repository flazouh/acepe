import { describe, expect, it } from "bun:test";

import { resolveDefaultAgentIdForCreate } from "../session-list-logic.js";

describe("resolveDefaultAgentIdForCreate", () => {
	const agents = [{ id: "claude-code" }, { id: "gemini" }];

	it("returns undefined when defaultAgentId is null", () => {
		expect(resolveDefaultAgentIdForCreate(agents, null)).toBe("claude-code");
	});

	it("returns undefined when defaultAgentId is undefined", () => {
		expect(resolveDefaultAgentIdForCreate(agents, undefined)).toBe("claude-code");
	});

	it("falls back to the first available agent when defaultAgentId is not in availableAgents", () => {
		expect(resolveDefaultAgentIdForCreate(agents, "removed-agent")).toBe("claude-code");
	});

	it("returns undefined when availableAgents is empty", () => {
		expect(resolveDefaultAgentIdForCreate([], "claude-code")).toBeUndefined();
	});

	it("returns the defaultAgentId when it is present in availableAgents", () => {
		expect(resolveDefaultAgentIdForCreate(agents, "gemini")).toBe("gemini");
	});
});
