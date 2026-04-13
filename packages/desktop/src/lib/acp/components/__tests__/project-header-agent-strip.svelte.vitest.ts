import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "$lib/messages.js";

import ProjectHeaderAgentStripHarness from "./project-header-agent-strip.test-harness.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("ProjectHeaderAgentStrip", () => {
	it("renders terminal and browser actions before agent actions", async () => {
		const onCancel = vi.fn();
		const onCreateSession = vi.fn();
		const onOpenTerminal = vi.fn();
		const onOpenBrowser = vi.fn();

		const { container } = render(ProjectHeaderAgentStripHarness, {
			projectPath: "/repo",
			projectName: "repo",
			availableAgents: [
				{ id: "claude", name: "Claude", icon: "claude" },
				{ id: "cursor", name: "Cursor", icon: "cursor" },
			],
			effectiveTheme: "light",
			onCancel,
			onCreateSession,
			onOpenTerminal,
			onOpenBrowser,
		});

		const labels = Array.from(container.querySelectorAll("button[aria-label]"))
			.map((button) => button.getAttribute("aria-label"))
			.filter((label): label is string => Boolean(label));
		const uniqueLabels = Array.from(new Set(labels));

		expect(uniqueLabels).toEqual([
			m.sidebar_open_terminal({ projectName: "repo" }),
			m.sidebar_open_browser({ projectName: "repo" }),
			m.thread_list_new_agent_session({ agentName: "Claude" }),
			m.thread_list_new_agent_session({ agentName: "Cursor" }),
			m.common_cancel(),
		]);

		const terminalButton = container.querySelector(
			`button[aria-label='${m.sidebar_open_terminal({ projectName: "repo" })}']`
		);
		const browserButton = container.querySelector(
			`button[aria-label='${m.sidebar_open_browser({ projectName: "repo" })}']`
		);
		const agentButton = container.querySelector(
			`button[aria-label='${m.thread_list_new_agent_session({ agentName: "Claude" })}']`
		);

		if (terminalButton) {
			await fireEvent.click(terminalButton);
		}
		if (browserButton) {
			await fireEvent.click(browserButton);
		}
		if (agentButton) {
			await fireEvent.click(agentButton);
		}

		expect(onOpenTerminal).toHaveBeenCalledWith("/repo");
		expect(onOpenBrowser).toHaveBeenCalledWith("/repo");
		expect(onCreateSession).toHaveBeenCalledWith("/repo", "claude");
		expect(onCancel).not.toHaveBeenCalled();
	});
});
