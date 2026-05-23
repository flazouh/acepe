import { cleanup, render, waitFor } from "@testing-library/svelte";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import type { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";
import {
	getAgentPanelDestroyCount,
	getAgentPanelMountCount,
	getAgentPanelRenderCount,
	resetAgentPanelStubState,
} from "./__tests__/fixtures/panels-container-agent-panel-stub-state";

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
	panelStore: null as PanelStore | null,
	sessionStore: null as SessionStore | null,
	agentStore: { agents: [] as readonly { id: string }[] },
	agentPreferencesStore: { selectedAgentIds: [] as readonly string[] },
	themeState: { effectiveTheme: "dark" },
}));

vi.mock("@acepe/ui", async () => ({
	AgentPanelDeck: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
	ProjectCard: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("$lib/acp/components/index.js", async () => ({
	AgentPanel: (await import("./__tests__/fixtures/panels-container-agent-panel-stub.svelte"))
		.default,
}));

vi.mock("$lib/acp/components/browser-panel/index.js", async () => ({
	BrowserPanel: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/file-panel/index.js", async () => ({
	FilePanel: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/review-panel/index.js", async () => ({
	ReviewPanel: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/terminal-panel/index.js", async () => ({
	TerminalPanel: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
	TerminalTabs: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/file-panel/file-panel-tabs.svelte", async () => ({
	default: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("./kanban-view.svelte", async () => ({
	default: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("./multi-project-group-label.svelte", async () => ({
	default: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/agent-panel/components/agent-error-card.svelte", async () => ({
	default: (await import("./__tests__/fixtures/panels-container-shell-stub.svelte")).default,
}));

vi.mock("$lib/acp/components/agent-panel/logic/clipboard-manager.js", () => ({
	copyTextToClipboard: vi.fn(),
}));

vi.mock("$lib/acp/components/agent-panel/logic/issue-report-draft.js", () => ({
	buildAgentErrorIssueDraft: vi.fn(() => ({})),
}));

vi.mock("$lib/acp/store/index.js", () => ({
	getPanelStore: () => hoisted.panelStore,
	getSessionStore: () => hoisted.sessionStore,
	getAgentStore: () => hoisted.agentStore,
	getAgentPreferencesStore: () => hoisted.agentPreferencesStore,
}));

vi.mock("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("$lib/components/theme/context.svelte.js", () => ({
	useTheme: () => hoisted.themeState,
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

vi.mock("../../logic/spawnable-agents.js", () => ({
	getSpawnableSessionAgents: vi.fn(() => [
		{ id: "claude-code", name: "Claude Code", icon: null, availability_kind: "available" },
		{ id: "cursor", name: "Cursor", icon: null, availability_kind: "available" },
	]),
}));

const { default: PanelsContainer } = await import("./panels-container.svelte");

function createProjectManager(): ProjectManager {
	const projectManager = new ProjectManager();
	projectManager.projectCount = 2;
	projectManager.projects = [
		{
			path: "/projects/alpha",
			name: "Alpha",
			createdAt: new Date(0),
			color: "#111111",
			iconPath: null,
		},
		{
			path: "/projects/beta",
			name: "Beta",
			createdAt: new Date(0),
			color: "#222222",
			iconPath: null,
		},
	];
	return projectManager;
}

function createMainAppState(): MainAppViewState {
	return Object.assign(Object.create(MainAppViewState.prototype), {
		handleClosePanel: vi.fn(),
		handleResizePanel: vi.fn(),
		handlePanelAgentChange: vi.fn(),
		handleToggleFullscreen: vi.fn(),
		handleFocusPanel: vi.fn(),
		handleCreateSessionForProject: vi.fn(() => okAsync(undefined)),
		openUserReportsWithDraft: vi.fn(),
	}) as MainAppViewState;
}

function createPanelStore(): PanelStore {
	const sessionStore = {
		getSessionCold: vi.fn(() => null),
		getSessionIdentity: vi.fn(() => null),
		getSessionMetadata: vi.fn(() => null),
	} as unknown as SessionStore;
	const agentStore = {
		getDefaultAgentId: vi.fn(() => "claude-code"),
	} as unknown as AgentStore;
	const panelStore = new PanelStore(sessionStore, agentStore, vi.fn());
	hoisted.panelStore = panelStore;
	hoisted.sessionStore = sessionStore;
	return panelStore;
}

describe("PanelsContainer", () => {
	beforeEach(() => {
		resetAgentPanelStubState();
	});

	afterEach(() => {
		cleanup();
		resetAgentPanelStubState();
	});

	it("keeps sibling agent panels stable when another disconnected panel changes project", async () => {
		const panelStore = createPanelStore();

		const stablePanel = panelStore.spawnPanel({
			projectPath: "/projects/alpha",
			selectedAgentId: "claude-code",
		});
		const changingPanel = panelStore.spawnPanel({
			requireProjectSelection: true,
			selectedAgentId: "cursor",
		});

		render(PanelsContainer, {
			projectManager: createProjectManager(),
			state: createMainAppState(),
		});

		await waitFor(() => {
			expect(getAgentPanelMountCount(stablePanel.id)).toBe(1);
			expect(getAgentPanelMountCount(changingPanel.id)).toBe(1);
		});

		resetAgentPanelStubState();

		panelStore.setPanelProjectPath(changingPanel.id, "/projects/beta");

		await waitFor(() => {
			expect(getAgentPanelRenderCount(changingPanel.id)).toBeGreaterThan(0);
		});

		expect(getAgentPanelRenderCount(stablePanel.id)).toBe(0);
		expect(getAgentPanelMountCount(stablePanel.id)).toBe(0);
		expect(getAgentPanelDestroyCount(stablePanel.id)).toBe(0);
	});

	it("keeps the fullscreen agent panel stable when another disconnected panel changes project", async () => {
		const panelStore = createPanelStore();

		const fullscreenPanel = panelStore.spawnPanel({
			projectPath: "/projects/alpha",
			selectedAgentId: "claude-code",
		});
		const changingPanel = panelStore.spawnPanel({
			requireProjectSelection: true,
			selectedAgentId: "cursor",
		});

		panelStore.focusedPanelId = fullscreenPanel.id;
		panelStore.viewMode = "single";

		render(PanelsContainer, {
			projectManager: createProjectManager(),
			state: createMainAppState(),
		});

		await waitFor(() => {
			expect(getAgentPanelMountCount(fullscreenPanel.id)).toBe(1);
		});

		resetAgentPanelStubState();

		panelStore.setPanelProjectPath(changingPanel.id, "/projects/beta");

		await waitFor(() => {
			expect(getAgentPanelRenderCount(changingPanel.id)).toBe(0);
		});

		expect(getAgentPanelRenderCount(fullscreenPanel.id)).toBe(0);
		expect(getAgentPanelMountCount(fullscreenPanel.id)).toBe(0);
		expect(getAgentPanelDestroyCount(fullscreenPanel.id)).toBe(0);
	});

	it("keeps the agent panel stable when another attached file opens in the same pane", async () => {
		const panelStore = createPanelStore();

		const panel = panelStore.spawnPanel({
			projectPath: "/projects/alpha",
			selectedAgentId: "claude-code",
		});

		panelStore.openFilePanel("src/first.ts", "/projects/alpha", { ownerPanelId: panel.id });

		render(PanelsContainer, {
			projectManager: createProjectManager(),
			state: createMainAppState(),
		});

		await waitFor(() => {
			expect(getAgentPanelMountCount(panel.id)).toBe(1);
		});

		resetAgentPanelStubState();

		panelStore.openFilePanel("src/second.ts", "/projects/alpha", { ownerPanelId: panel.id });

		await waitFor(() => {
			expect(panelStore.getAttachedFilePanels(panel.id)).toHaveLength(2);
		});

		expect(getAgentPanelRenderCount(panel.id)).toBe(0);
		expect(getAgentPanelMountCount(panel.id)).toBe(0);
		expect(getAgentPanelDestroyCount(panel.id)).toBe(0);
	});

	it("keeps the focused agent panel mounted when entering fullscreen", async () => {
		const panelStore = createPanelStore();

		const panel = panelStore.spawnPanel({
			projectPath: "/projects/alpha",
			selectedAgentId: "claude-code",
		});

		const rendered = render(PanelsContainer, {
			projectManager: createProjectManager(),
			state: createMainAppState(),
		});

		await waitFor(() => {
			expect(getAgentPanelMountCount(panel.id)).toBe(1);
		});

		resetAgentPanelStubState();

		panelStore.switchFullscreen(panel.id);

		await waitFor(() => {
			expect(rendered.getByTestId(`agent-panel-${panel.id}`).dataset.isFullscreen).toBe("true");
		});

		expect(getAgentPanelMountCount(panel.id)).toBe(0);
		expect(getAgentPanelDestroyCount(panel.id)).toBe(0);

		resetAgentPanelStubState();

		panelStore.setViewMode("project");

		await waitFor(() => {
			expect(rendered.getByTestId(`agent-panel-${panel.id}`).dataset.isFullscreen).toBe("false");
		});

		expect(getAgentPanelMountCount(panel.id)).toBe(0);
		expect(getAgentPanelDestroyCount(panel.id)).toBe(0);
	});
});
