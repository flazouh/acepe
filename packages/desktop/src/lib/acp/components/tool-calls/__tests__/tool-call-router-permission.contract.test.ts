import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../tool-call-router.svelte"), "utf8");

describe("tool call router permission contract", () => {
	it("does not render an inline permission action bar for anchored permissions", () => {
		expect(source).not.toContain('import PermissionActionBar from "./permission-action-bar.svelte";');
		expect(source).not.toContain("<PermissionActionBar permission={pendingPermission} inline hideHeader />");
	});

	it("routes through the shared tool definition registry instead of a local component map", () => {
		expect(source).toContain(
			'import { getToolDefinition } from "./tool-definition-registry.js";'
		);
		expect(source).not.toContain(
			'import { getToolDetailComponent } from "./tool-detail-component-registry.js";'
		);
		expect(source).not.toContain("const DEDICATED_COMPONENTS:");
		expect(source).toContain("const toolDefinition = $derived(");
		expect(source).toContain("const ToolComponent = $derived(toolDefinition.component);");
	});

	it("does not branch on provider names or transport-shaped reply fields", () => {
		expect(source).not.toContain("jsonRpcRequestId");
		expect(source).not.toContain("claude-code");
		expect(source).not.toContain("cursor");
		expect(source).not.toContain("copilot");
		expect(source).not.toContain("codex");
		expect(source).not.toContain("opencode");
	});
});
