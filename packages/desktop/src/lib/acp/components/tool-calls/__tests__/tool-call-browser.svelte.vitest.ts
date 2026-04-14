import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolCall } from "../../../types/tool-call.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

const { default: ToolCallBrowser } = await import("../tool-call-browser.svelte");

function createBrowserToolCall(script: string): ToolCall {
	return {
		id: "browser-tool-1",
		name: "mcp__tauri__webview_execute_js",
		kind: "browser",
		status: "completed",
		title: "Execute JS",
		arguments: {
			kind: "browser",
			raw: {
				script,
			},
		},
		result: {
			content: '{"ok":true}',
		},
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
	};
}

describe("ToolCallBrowser", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders long execute-js scripts as a collapsible preview", async () => {
		const script = [
			"(() => {",
			"  const elements = Array.from(document.querySelectorAll('[data-ref]'));",
			"  return elements.map((element) => ({",
			"    text: element.textContent?.trim() ?? '',",
			"    role: element.getAttribute('role') ?? 'none',",
			"  }));",
			"})()",
		].join("\n");

		const view = render(ToolCallBrowser, {
			toolCall: createBrowserToolCall(script),
			turnState: "completed",
		});

		expect(view.getByText("Execute Js")).toBeTruthy();
		expect(view.getByLabelText("Expand script")).toBeTruthy();
		expect(view.queryByTestId("browser-script-content")).toBeNull();
		expect(view.getByTestId("browser-script-preview").textContent).toContain("const elements");

		await fireEvent.click(view.getByLabelText("Expand script"));

		expect(view.getByLabelText("Collapse script")).toBeTruthy();
		expect(view.getByTestId("browser-script-content").textContent).toContain(
			"document.querySelectorAll"
		);
	});
});
