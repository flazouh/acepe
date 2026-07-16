import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPanelProps } from "$lib/acp/components/agent-panel/types/agent-panel-props.js";
import { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { MainAppViewState } from "../../../logic/main-app-view-state.svelte.js";

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

const hoisted = vi.hoisted(() => ({
	panelStore: {
		getHotState: vi.fn(() => null),
		getAttachedFilePanels: vi.fn(() => []),
		getActiveFilePanelId: vi.fn(() => null),
		getActiveAttachedFilePanel: vi.fn(() => null),
		updatePanelSession: vi.fn(),
		setActiveAttachedFilePanel: vi.fn(),
		closeFilePanel: vi.fn(),
		resizeFilePanel: vi.fn(),
	},
	sessionStore: {
		read: {
			getSessionIdentity: vi.fn(() => undefined),
			getSessionMetadata: vi.fn(() => undefined),
		},
		getSessionCold: vi.fn(() => null),
	},
	themeState: { effectiveTheme: "dark" },
}));

vi.mock("$lib/acp/components/index.js", async () => ({
	AgentPanel: (await import("./fixtures/agent-panel-host-throwing-agent-panel.svelte")).default,
}));

vi.mock("$lib/acp/components/agent-panel/components/agent-error-card.svelte", async () => ({
	default: (await import("./fixtures/agent-panel-host-error-card-stub.svelte")).default,
}));

vi.mock("$lib/acp/store/index.js", () => ({
	getPanelStore: () => hoisted.panelStore,
	getSessionStore: () => hoisted.sessionStore,
}));

vi.mock("$lib/components/theme/context.svelte.js", () => ({
	useTheme: () => hoisted.themeState,
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("$lib/acp/components/agent-panel/logic/clipboard-manager.js", () => ({
	copyTextToClipboard: vi.fn(),
}));

vi.mock("$lib/acp/components/agent-panel/logic/issue-report-draft.js", () => ({
	buildAgentErrorIssueDraft: vi.fn(() => ({})),
}));

vi.mock("$lib/errors/error-reference.js", () => ({
	ensureErrorReference: vi.fn(() => ({
		referenceId: "ref-1",
		searchable: "ref-1",
	})),
}));

vi.mock("$lib/errors/issue-report.js", () => ({
	resolveIssueActionLabel: vi.fn(() => "Report issue"),
}));

const { default: AgentPanelHost } = await import("../agent-panel-host.svelte");

afterEach(() => {
	cleanup();
});

function createProjectManager(): ProjectManager {
	const projectManager = new ProjectManager();
	projectManager.projectCount = 1;
	projectManager.projects = [
		{
			path: "/repo",
			name: "Repo",
			createdAt: new Date(0),
			color: "#123456",
			iconPath: null,
		},
	];
	return projectManager;
}

describe("AgentPanelHost", () => {
	it("keeps the error fallback renderable after the panel ref is cleared", async () => {
		const panelRef = {
			current: {
				id: "panel-1",
				kind: "agent" as const,
				ownerPanelId: null,
				sessionId: "session-1",
				width: 480,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: "claude-code",
				projectPath: "/repo",
				agentId: "claude-code",
				sourcePath: null,
				worktreePath: null,
				sessionTitle: "Broken panel",
			},
		} as {
			current: {
				id: string;
				kind: "agent";
				ownerPanelId: null;
				sessionId: string;
				width: number;
				pendingProjectSelection: boolean;
				pendingWorktreeEnabled: null;
				preparedWorktreeLaunch: null;
				selectedAgentId: string;
				projectPath: string;
				agentId: string;
				sourcePath: null;
				worktreePath: null;
				sessionTitle: string;
			} | null;
		};

		const state = Object.assign(Object.create(MainAppViewState.prototype), {
			handlePanelAgentChange: vi.fn(),
			handleClosePanel: vi.fn(() => {
				panelRef.current = null;
			}),
			handleCreateSessionForProject: vi.fn(() => okAsync(undefined)),
			handleResizePanel: vi.fn(),
			handleToggleFullscreen: vi.fn(),
			handleFocusPanel: vi.fn(),
			openUserReportsWithDraft: vi.fn(),
		}) as MainAppViewState;
		const availableAgents: AgentPanelProps["availableAgents"] = [
			{
				id: "claude-code",
				name: "Claude Code",
				icon: "data:image/svg+xml,hugeicons",
			},
		];

		const props = {
			panelId: "panel-1",
			panelRef,
			projectManager: createProjectManager(),
			state,
			availableAgents,
			hideProjectBadge: false,
			isFullscreen: false,
			isFocused: true,
		};

		const view = render(AgentPanelHost, props);
		expect(view.getByTestId("agent-panel-host").getAttribute("data-qa-agent-panel-id")).toBe(
			"panel-1"
		);
		expect(hoisted.panelStore.getActiveFilePanelId).not.toHaveBeenCalled();
		expect(hoisted.panelStore.getActiveAttachedFilePanel).not.toHaveBeenCalled();

		await fireEvent.click(view.getByTestId("trigger-close-crash"));
		expect(state.handleClosePanel).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(view.getByTestId("agent-error-card")).toBeTruthy();
		});
	});
});
