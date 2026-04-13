import { describe, expect, it } from "vitest";

import { toAgentToolKind } from "./tool-kind-to-agent-tool-kind.js";

describe("toAgentToolKind", () => {
	it("maps shared-compatible tool kinds directly", () => {
		expect(toAgentToolKind("read")).toBe("read");
		expect(toAgentToolKind("task")).toBe("task");
		expect(toAgentToolKind("task_output")).toBe("task_output");
		expect(toAgentToolKind("question")).toBe("question");
	});

	it("normalizes desktop-only tool kinds to the shared presentational subset", () => {
		expect(toAgentToolKind("glob")).toBe("search");
		expect(toAgentToolKind("tool_search")).toBe("other");
		expect(toAgentToolKind("todo")).toBe("todo");
	});

	it("preserves an omitted kind", () => {
		expect(toAgentToolKind(null)).toBeUndefined();
		expect(toAgentToolKind(undefined)).toBeUndefined();
	});
});
