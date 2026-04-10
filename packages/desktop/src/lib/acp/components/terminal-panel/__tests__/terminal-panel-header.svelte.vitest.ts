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

import TerminalPanelHeader from "../terminal-panel-header.svelte";

afterEach(cleanup);

describe("TerminalPanelHeader", () => {
	it("keeps the more button hidden on unselected tabs until hover", async () => {
		render(TerminalPanelHeader, {
			projectName: "app",
			projectColor: "#fff",
			shell: "/bin/zsh",
			onClose: vi.fn(),
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
			selectedTabId: "tab-2",
			onSelectTab: vi.fn(),
			onNewTab: vi.fn(),
			onCloseTab: vi.fn(),
			onMoveTabToNewPanel: vi.fn(),
			canMoveTabToNewPanel: () => true,
		});

		const triggers = screen.getAllByLabelText(/terminal tab actions/i);
		expect(triggers[0]?.className.includes("opacity-0")).toBe(true);
	});

	it("keeps the more button visible for the selected tab and keyboard focus", async () => {
		render(TerminalPanelHeader, {
			projectName: "app",
			projectColor: "#fff",
			shell: "/bin/zsh",
			onClose: vi.fn(),
			tabs: [
				{
					id: "tab-1",
					groupId: "group-1",
					projectPath: "/tmp/project",
					createdAt: 1,
					ptyId: null,
					shell: null,
				},
			],
			selectedTabId: "tab-1",
			onSelectTab: vi.fn(),
			onNewTab: vi.fn(),
			onCloseTab: vi.fn(),
			onMoveTabToNewPanel: vi.fn(),
			canMoveTabToNewPanel: () => false,
		});

		const trigger = screen.getByLabelText(/terminal tab actions/i);
		expect(trigger.className.includes("opacity-100")).toBe(true);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);
	});

	it("shows a per-tab more menu and fires open-in-new-panel", async () => {
		const onMoveTabToNewPanel = vi.fn();

		render(TerminalPanelHeader, {
			projectName: "app",
			projectColor: "#fff",
			shell: "/bin/zsh",
			onClose: vi.fn(),
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
			selectedTabId: "tab-2",
			onSelectTab: vi.fn(),
			onNewTab: vi.fn(),
			onCloseTab: vi.fn(),
			onMoveTabToNewPanel,
			canMoveTabToNewPanel: (tabId: string) => tabId !== "tab-1",
		});

		const triggers = screen.getAllByLabelText(/terminal tab actions/i);
		await fireEvent.click(triggers[1] ?? triggers[0]);
		await fireEvent.click(screen.getByRole("menuitem", { name: /open in new panel/i }));

		expect(onMoveTabToNewPanel).toHaveBeenCalledWith("tab-2");
	});

	it("omits open in new panel for a single-tab panel", async () => {
		render(TerminalPanelHeader, {
			projectName: "app",
			projectColor: "#fff",
			shell: "/bin/zsh",
			onClose: vi.fn(),
			tabs: [
				{
					id: "tab-1",
					groupId: "group-1",
					projectPath: "/tmp/project",
					createdAt: 1,
					ptyId: null,
					shell: null,
				},
			],
			selectedTabId: "tab-1",
			onSelectTab: vi.fn(),
			onNewTab: vi.fn(),
			onCloseTab: vi.fn(),
			onMoveTabToNewPanel: vi.fn(),
			canMoveTabToNewPanel: () => false,
		});

		await fireEvent.click(screen.getByLabelText(/terminal tab actions/i));
		expect(screen.queryByRole("menuitem", { name: /open in new panel/i })).toBeNull();
	});
});
