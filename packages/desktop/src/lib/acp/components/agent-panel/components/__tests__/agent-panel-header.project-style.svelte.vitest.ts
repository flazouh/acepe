import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "$lib/paraglide/messages.js";

import AgentPanelHeader from "../agent-panel-header.svelte";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

afterEach(() => {
	cleanup();
});

describe("AgentPanelHeader project-header style", () => {
	it("keeps fullscreen and close behaviors while using embedded controls", async () => {
		const onClose = vi.fn();
		const onToggleFullscreen = vi.fn();

		const { container } = render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: null,
			sessionTitle: "Thread",
			sessionAgentId: null,
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose,
			onToggleFullscreen,
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: null,
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onScrollToTop: undefined,
			debugPanelState: null,
		});

		const fullscreen = container.querySelector(`button[title='${m.panel_fullscreen()}']`);
		const close = container.querySelector(`button[title='${m.common_close()}']`);
		const header = container.firstElementChild;

		expect(fullscreen).not.toBeNull();
		expect(close).not.toBeNull();
		expect(header?.className).toContain("bg-card/50");
		expect(fullscreen?.className).toContain("h-7");
		expect(close?.className).toContain("h-7");

		if (fullscreen) {
			await fireEvent.click(fullscreen);
		}
		if (close) {
			await fireEvent.click(close);
		}

		expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not expose a delete action in the overflow menu", async () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: null,
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: vi.fn(),
			onExportRawStreaming: undefined,
			displayTitle: "Thread",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: vi.fn(),
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onScrollToTop: undefined,
			debugPanelState: null,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByRole("menuitem", { name: m.thread_open_in_finder() })).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: m.session_menu_delete() })).toBeNull();
	});
});
