import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("$lib/paraglide/messages.js", () => ({
	terminal_panel_title: () => "Terminal",
	common_close: () => "Close",
	terminal_new_tab: () => "New tab",
	panel_fullscreen: () => "Enter fullscreen",
	panel_exit_fullscreen: () => "Exit fullscreen",
}));

vi.mock("../terminal-panel.svelte", async () => ({
	default: (await import("./fixtures/terminal-panel-stub.svelte")).default,
}));

import TerminalTabs from "../terminal-tabs.svelte";

afterEach(cleanup);

describe("TerminalTabs", () => {
	it("wires new-tab and move-to-panel actions through the group-scoped store API", async () => {
		const panelStore = {
			fullscreenPanelId: null,
			focusedPanelId: null,
			viewMode: "project" as const,
			openTerminalTab: vi.fn(),
			moveTerminalTabToNewPanel: vi.fn(),
			getSelectedTerminalTabId: vi.fn(() => "tab-2"),
			getSelectedTerminalTab: vi.fn(() => ({
				id: "tab-2",
				groupId: "group-1",
				projectPath: "/tmp/project",
				createdAt: 2,
				ptyId: null,
				shell: null,
			})),
			setSelectedTerminalTab: vi.fn(),
			closeTerminalTab: vi.fn(),
			enterTerminalFullscreen: vi.fn(),
			exitFullscreen: vi.fn(),
			closeTerminalPanel: vi.fn(),
			resizeTerminalPanel: vi.fn(),
			updateTerminalPtyId: vi.fn(),
			canMoveTerminalTabToNewPanel: vi.fn((tabId: string) => tabId === "tab-2"),
		};

		render(TerminalTabs, {
			group: {
				id: "group-1",
				projectPath: "/tmp/project",
				width: 500,
				selectedTabId: "tab-2",
				order: 0,
			},
			tabs: [
				{
					id: "tab-1",
					groupId: "group-1",
					projectPath: "/tmp/project",
					createdAt: 1,
					ptyId: null,
					shell: null,
				},
				{
					id: "tab-2",
					groupId: "group-1",
					projectPath: "/tmp/project",
					createdAt: 2,
					ptyId: null,
					shell: null,
				},
			],
			projectPath: "/tmp/project",
			projectName: "app",
			projectColor: "#fff",
			panelStore,
		});

		await fireEvent.click(screen.getByTitle(/new tab/i));
		expect(panelStore.openTerminalTab).toHaveBeenCalledWith("group-1");

		const triggers = screen.getAllByLabelText(/terminal tab actions/i);
		await fireEvent.click(triggers[1] ?? triggers[0]);
		await fireEvent.click(screen.getByRole("menuitem", { name: /open in new panel/i }));
		expect(panelStore.moveTerminalTabToNewPanel).toHaveBeenCalledWith("tab-2");
	});
});
