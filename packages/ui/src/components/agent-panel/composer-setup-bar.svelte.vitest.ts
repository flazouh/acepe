import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import ComposerSetupBar from "./composer-setup-bar.svelte";
import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("ComposerSetupBar", () => {
	it("renders skills, mcp servers, and preconnection options", () => {
		const option: AgentInputConfigOption = {
			id: "reasoning_effort",
			name: "Reasoning Effort",
			category: "reasoning_effort",
			type: "select",
			currentValue: "auto",
			options: [{ value: "auto", name: "Auto" }],
			presentation: "compactReasoning",
		};
		render(ComposerSetupBar, {
			props: {
				skillsHeading: "Skills",
				mcpHeading: "MCP servers",
				optionsHeading: "Setup",
				skills: [{ id: "issue-244-review", name: "issue-244-review" }],
				servers: [{ id: "github", name: "github", status: "unknown" }],
				configOptions: [option],
				onOptionValueChange: vi.fn(),
			},
		});
		expect(screen.getByTestId("new-thread-options")).toBeTruthy();
		expect(screen.getByTestId("skill-row").textContent).toContain("issue-244-review");
		expect(screen.getByTestId("mcp-server-row").textContent).toContain("github");
		expect(screen.getByTestId("preconnection-option").getAttribute("data-option-id")).toBe(
			"reasoning_effort",
		);
	});
});
