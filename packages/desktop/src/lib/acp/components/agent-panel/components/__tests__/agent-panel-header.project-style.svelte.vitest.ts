import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPanelHeaderProps } from "../../types/agent-panel-header-props.js";
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
	it("moves fullscreen into the overflow menu while keeping close in the header", async () => {
		const onClose = vi.fn();
		const onToggleFullscreen = vi.fn();

		const { container } = render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: null,
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
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
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		const close = container.querySelector(`button[title='${"Close"}']`);
		const header = container.firstElementChild;

		expect(container.querySelector(`button[title='${"Fullscreen"}']`)).toBeNull();
		expect(close).not.toBeNull();
		expect(header?.className).toContain("bg-card/50");
		expect(close?.className).toContain("size-5");
		expect(screen.getByLabelText("More actions").className).toContain("size-5");

		await fireEvent.click(screen.getByLabelText("More actions"));
		const displayMenu = screen.getByRole("menuitem", { name: "Display" });
		await fireEvent.keyDown(displayMenu, { key: "ArrowRight", code: "ArrowRight" });
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Fullscreen" }));

		if (close) {
			await fireEvent.click(close);
		}

		expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not add a trailing border in fullscreen mode", () => {
		const { container } = render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: null,
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: true,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
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
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		expect(container.firstElementChild?.className).not.toContain("border-r");
	});

	it("shows the computed display title before the session title is hydrated", () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: null,
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Fix login redirect race",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		expect(screen.getAllByText("Fix login redirect race").length).toBeGreaterThan(0);
		expect(screen.queryByText("New thread")).toBeNull();
	});

	it("shows the selected agent icon before a session is attached", () => {
		const { container } = render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: true,
			sessionId: null,
			sessionTitle: null,
			sessionAgentId: null,
			currentAgentId: "claude-code",
			availableAgents: [],
			agentIconSrc: "/agent.svg",
			agentName: "Claude",
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: false,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Diagnostic ping - reply with ok",
			entriesCount: 1,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		expect(container.querySelector('img[src="/agent.svg"]')).not.toBeNull();
		expect(screen.queryByLabelText("Connecting to Claude...")).toBeNull();
		expect(container.querySelector(".animate-ping")).toBeNull();
	});

	it("renders no warming spinner while connecting after first send", () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: null,
			sessionTitle: null,
			sessionAgentId: null,
			currentAgentId: "claude-code",
			availableAgents: [],
			agentIconSrc: "/agent.svg",
			agentName: "Claude",
			isFullscreen: false,
			sessionStatus: "warming",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: false,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Diagnostic ping - reply with ok",
			entriesCount: 1,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		expect(screen.queryByLabelText("Connecting to Claude...")).toBeNull();
		expect(screen.queryByLabelText("Retrying thread")).toBeNull();
	});

	it("shows immediate retry feedback in the header status bubble", async () => {
		const onRetryConnection = vi.fn();
		const props = {
			pendingProjectSelection: false,
			isConnecting: false,
			isRetryingConnection: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: "codex",
			currentAgentId: "codex",
			availableAgents: [],
			agentIconSrc: "",
			agentName: "Codex",
			isFullscreen: false,
			sessionStatus: "error",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onRetryConnection,
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Thread",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		} satisfies AgentPanelHeaderProps;

		const view = render(AgentPanelHeader, props);

		await fireEvent.click(screen.getByRole("button", { name: "Thread error - click to retry" }));

		expect(onRetryConnection).toHaveBeenCalledTimes(1);

		await view.rerender({
			...props,
			isRetryingConnection: true,
		});

		expect(screen.queryByRole("button", { name: "Thread error - click to retry" })).toBeNull();
		expect(screen.getByLabelText("Retrying thread")).not.toBeNull();
	});

	it("shows panel tools in the overflow menu", async () => {
		const onToggleBrowser = vi.fn();
		const onToggleTerminal = vi.fn();

		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onToggleBrowser,
			onToggleTerminal,
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
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByRole("menuitem", { name: "Copy" })).not.toBeNull();
		expect(screen.getByRole("menuitem", { name: "Open" })).not.toBeNull();
		expect(screen.getByRole("menuitem", { name: "Display" })).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Open Thread in Finder" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Delete session" })).toBeNull();

		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Display" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Show browser" }));
		expect(onToggleBrowser).toHaveBeenCalledTimes(1);

		await fireEvent.click(screen.getByLabelText("More actions"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Display" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});
		await fireEvent.click(await screen.findByRole("menuitem", { name: "Show terminal" }));

		expect(onToggleBrowser).toHaveBeenCalledTimes(1);
		expect(onToggleTerminal).toHaveBeenCalledTimes(1);
	});

	it("keeps pull request actions inside the open submenu", async () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			linkedPr: {
				prNumber: 42,
				state: "OPEN",
				url: "https://github.com/flazouh/acepe/pull/42",
				title: "Clean up header menu",
				additions: null,
				deletions: null,
				isDraft: false,
				isLoading: false,
				hasResolvedDetails: true,
				checksHeadSha: null,
				checks: [],
				isChecksLoading: false,
				hasResolvedChecks: true,
			},
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Thread",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByRole("menuitem", { name: "Open" })).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Open Pull Request #42" })).toBeNull();

		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Open" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});

		expect(await screen.findByRole("menuitem", { name: "Open Pull Request #42" })).not.toBeNull();
	});

	it("renders the Hugeicons copy-id icon for the session id menu action", async () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onExportRawStreaming: undefined,
			displayTitle: "Thread",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Copy" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});

		const sessionIdItem = await screen.findByRole("menuitem", { name: "Session ID" });
		const renderedIcon = sessionIdItem.querySelector("svg");

		expect(renderedIcon?.tagName.toLowerCase()).toBe("svg");
		expect(renderedIcon?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(renderedIcon?.innerHTML).not.toBe("");
	});

	it("renders the Hugeicons Copy icon for the thread content menu action", async () => {
		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: null,
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: vi.fn(),
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
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));
		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Copy" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});

		const threadContentItem = await screen.findByRole("menuitem", { name: "Thread content" });
		const renderedIcon = threadContentItem.querySelector("svg");

		expect(renderedIcon?.tagName.toLowerCase()).toBe("svg");
		expect(renderedIcon?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(renderedIcon?.innerHTML).not.toBe("");
	});

	it("groups dev-only log actions under diagnostics", async () => {
		const onCopyStreamingLogPath = vi.fn();
		const onExportRawStreaming = vi.fn();

		render(AgentPanelHeader, {
			pendingProjectSelection: false,
			isConnecting: false,
			sessionId: "session-1",
			sessionTitle: "Thread",
			sessionAgentId: null,
			currentAgentId: null,
			availableAgents: [],
			agentIconSrc: "",
			agentName: null,
			isFullscreen: false,
			sessionStatus: "empty",
			projectPath: "/repo",
			projectName: "repo",
			projectColor: "#FF5D5A",
			hideProjectBadge: true,
			onClose: vi.fn(),
			onToggleFullscreen: vi.fn(),
			onCopyContent: undefined,
			onOpenInFinder: undefined,
			onCopyStreamingLogPath,
			onExportRawStreaming,
			displayTitle: "Thread",
			entriesCount: 0,
			insertions: 0,
			deletions: 0,
			createdAt: null,
			updatedAt: null,
			onOpenRawFile: undefined,
			onOpenInAcepe: undefined,
			onExportMarkdown: undefined,
			onExportJson: undefined,
			onAgentChange: undefined,
			onScrollToTop: undefined,
		});

		await fireEvent.click(screen.getByLabelText("More actions"));

		expect(screen.getByRole("menuitem", { name: "Diagnostics" })).not.toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Developer" })).toBeNull();

		await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Diagnostics" }), {
			key: "ArrowRight",
			code: "ArrowRight",
		});
		const copyLogPathItem = await screen.findByRole("menuitem", {
			name: "Copy Streaming Log Path",
		});
		const renderedIcon = copyLogPathItem.querySelector("svg");

		expect(renderedIcon?.tagName.toLowerCase()).toBe("svg");
		expect(renderedIcon?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(renderedIcon?.innerHTML).not.toBe("");

		await fireEvent.click(copyLogPathItem);

		expect(onCopyStreamingLogPath).toHaveBeenCalledTimes(1);
		expect(onExportRawStreaming).not.toHaveBeenCalled();
	});
});
