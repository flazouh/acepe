import { describe, expect, it } from "vitest";

import { toAgentToolKind } from "./tool-kind-to-agent-tool-kind.js";

describe("toAgentToolKind", () => {
	it("maps shared-compatible tool kinds directly", () => {
		expect(toAgentToolKind("read")).toBe("read");
		expect(toAgentToolKind("read_lints")).toBe("read_lints");
		expect(toAgentToolKind("task")).toBe("task");
		expect(toAgentToolKind("task_output")).toBe("task_output");
		expect(toAgentToolKind("browser")).toBe("browser");
		expect(toAgentToolKind("delete")).toBe("delete");
	});

	it("normalizes desktop-only tool kinds to the shared presentational subset", () => {
		expect(toAgentToolKind("glob")).toBe("search");
		expect(toAgentToolKind("tool_search")).toBe("other");
		expect(toAgentToolKind("todo")).toBe("other");
		expect(toAgentToolKind("sql")).toBe("sql");
		expect(toAgentToolKind("unclassified")).toBe("unclassified");
	});

	it("preserves an omitted kind", () => {
		expect(toAgentToolKind(null)).toBeUndefined();
		expect(toAgentToolKind(undefined)).toBeUndefined();
	});
});

// CHARACTERIZATION: some desktop `ToolKind` values still map to `"other"` until the shared
// `AgentToolKind` union gains dedicated variants for every surface.
describe("CHARACTERIZATION: canonical kinds flattened to agent-tool-kind other", () => {
	it("maps question, todo, and plan-mode kinds to other", () => {
		expect(toAgentToolKind("question")).toBe("other");
		expect(toAgentToolKind("todo")).toBe("other");
		expect(toAgentToolKind("move")).toBe("other");
		expect(toAgentToolKind("enter_plan_mode")).toBe("other");
		expect(toAgentToolKind("exit_plan_mode")).toBe("other");
		expect(toAgentToolKind("create_plan")).toBe("other");
		expect(toAgentToolKind("tool_search")).toBe("other");
	});
});
