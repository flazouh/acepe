import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStore } from "$lib/acp/store/agent-store.svelte.js";
import { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import { SessionStore } from "$lib/acp/store/session-store.svelte.js";

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

let panelStore: PanelStore;

const sendMessageMock = vi.fn();
const getSessionColdMock = vi.fn(
	(_sessionId: string): ReturnType<SessionStore["getSessionCold"]> => undefined
);
const getDefaultAgentIdMock = vi.fn(
	(): ReturnType<AgentStore["getDefaultAgentId"]> => "claude-code"
);

vi.mock("$lib/acp/store/index.js", () => ({
	getPanelStore: () => panelStore,
	getSessionStore: () => ({
		sendMessage: sendMessageMock,
	}),
}));

vi.mock("$lib/acp/components/git-panel/index.js", async () => ({
	GitPanel: (await import("./fixtures/git-panel-stub.svelte")).default,
}));

const { flushSync } = await import("svelte");
const { default: SourceControlDialog } = await import("../source-control-dialog.svelte");

function createPanelStore(): PanelStore {
	const sessionStore = Object.create(SessionStore.prototype) as SessionStore;
	sessionStore.getSessionCold = getSessionColdMock;
	sessionStore.sendMessage = sendMessageMock;
	const agentStore = Object.create(AgentStore.prototype) as AgentStore;
	agentStore.getDefaultAgentId = getDefaultAgentIdMock;

	return new PanelStore(sessionStore, agentStore, vi.fn());
}

function createProjectManager(): ProjectManager {
	const projectManager = new ProjectManager();
	projectManager.projects = [
		{
			path: "/tmp/project",
			name: "Project",
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			color: "#4AD0FF",
			iconPath: null,
		},
	];
	return projectManager;
}

describe("SourceControlDialog", () => {
	beforeEach(() => {
		getSessionColdMock.mockReset();
		getSessionColdMock.mockReturnValue(undefined);
		getDefaultAgentIdMock.mockReset();
		getDefaultAgentIdMock.mockReturnValue("claude-code");
		sendMessageMock.mockReset();
		panelStore = createPanelStore();
	});

	afterEach(() => {
		cleanup();
	});

	it("tears down cleanly after the git dialog is cleared", () => {
		panelStore.openGitDialog("/tmp/project");

		const view = render(SourceControlDialog, {
			projectManager: createProjectManager(),
		});

		expect(view.getByTestId("git-panel-stub").getAttribute("data-project-path")).toBe(
			"/tmp/project"
		);

		panelStore.closeGitDialog();
		flushSync();

		expect(view.queryByTestId("git-panel-stub")).toBeNull();
	});
});
