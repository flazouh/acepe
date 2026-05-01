import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { PanelViewState } from "../../../../logic/panel-visibility.js";

const storageMock: Storage = {
	length: 0,
	clear: () => undefined,
	getItem: () => null,
	key: () => null,
	removeItem: () => undefined,
	setItem: () => undefined,
};

Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: storageMock,
});
Object.defineProperty(globalThis, "sessionStorage", {
	configurable: true,
	value: storageMock,
});

const sessionStoreState = vi.hoisted(() => ({
	runtimeState: null as null | {
		connectionPhase: "disconnected" | "connecting" | "connected" | "failed";
		contentPhase: "empty" | "loading" | "loaded";
		activityPhase: "idle" | "running" | "waiting_for_user";
		canSubmit: boolean;
		canCancel: boolean;
		showStop: boolean;
		showThinking: boolean;
		showConnectingOverlay: boolean;
		showConversation: boolean;
		showReadyPlaceholder: boolean;
	},
	hotState: {
		turnState: "idle" as "idle" | "running" | "completed" | "error",
		status: "idle" as "idle" | "loading" | "connecting" | "ready" | "streaming" | "error",
		currentMode: null,
		connectionError: null,
		activeTurnFailure: null,
		activity: null as null | {
			kind:
				| "awaiting_model"
				| "running_operation"
				| "waiting_for_user"
				| "paused"
				| "error"
				| "idle";
			activeOperationCount: number;
			activeSubagentCount: number;
			dominantOperationId: string | null;
			blockingInteractionId: string | null;
		},
	},
}));

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui", async () => ({
	TextShimmer: (await import("./fixtures/user-message-stub.svelte")).default,
	setIconConfig: () => undefined,
}));

vi.mock("mode-watcher", () => ({
	mode: { current: "dark" },
}));

vi.mock("../../../../store/session-store.svelte.js", () => ({
	getSessionStore: () => ({
		getSessionRuntimeState: () => sessionStoreState.runtimeState,
		getHotState: () => sessionStoreState.hotState,
		getCanonicalSessionProjection: () => null,
		getOperationStore: () => ({
			getCurrentStreamingToolCall: () => null,
		}),
	}),
}));

vi.mock("../../../../store/interaction-store.svelte.js", () => ({
	getInteractionStore: () => ({}),
}));

vi.mock("../../../../store/operation-association.js", () => ({
	buildSessionOperationInteractionSnapshot: () => ({
		pendingQuestion: null,
		pendingQuestionOperation: null,
		pendingPermission: null,
		pendingPermissionOperation: null,
		pendingPlanApproval: null,
		pendingPlanApprovalOperation: null,
	}),
}));

vi.mock("../../messages/message-wrapper.svelte", async () => ({
	default: (await import("./fixtures/message-wrapper-stub.svelte")).default,
}));

vi.mock("../../messages/user-message.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../messages/assistant-message.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../project-selection-panel.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../ready-to-assist-placeholder.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../virtualized-entry-list.svelte", async () => ({
	default: (await import("./fixtures/virtualized-entry-list-stub.svelte")).default,
}));

import AgentPanelContent from "../agent-panel-content.svelte";

function createUserSceneEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return { id, type: "user", text };
}

function renderContent(
	viewState: PanelViewState,
	overrides?: {
		sessionId?: string | null;
		sceneEntries?: readonly AgentPanelSceneEntryModel[];
		isWaitingForResponse?: boolean;
	}
) {
	return render(AgentPanelContent, {
		panelId: "panel-1",
		viewState,
		sessionId: overrides?.sessionId !== undefined ? overrides.sessionId : "session-1",
		sceneEntries: overrides?.sceneEntries,
		sessionProjectPath: null,
		allProjects: [],
		scrollContainer: null,
		scrollViewport: null,
		isAtBottom: true,
		isAtTop: true,
		isStreaming: false,
		onProjectSelected: vi.fn(),
		onRetryConnection: undefined,
		onCancelConnection: undefined,
		agentIconSrc: "",
		isFullscreen: false,
		availableAgents: [],
		effectiveTheme: "dark",
		modifiedFilesState: null,
		isWaitingForResponse: overrides?.isWaitingForResponse,
	});
}

describe("AgentPanelContent", () => {
	afterEach(() => {
		cleanup();
		sessionStoreState.runtimeState = null;
		sessionStoreState.hotState = {
			turnState: "idle",
			status: "idle",
			currentMode: null,
			connectionError: null,
			activeTurnFailure: null,
			activity: null,
		};
	});

	it("renders the virtualized conversation list for active sessions", () => {
		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub")).toBeTruthy();
	});

	it("forwards an explicit waiting-state prop to the conversation list", () => {
		const view = renderContent(
			{ kind: "conversation", errorDetails: null },
			{ isWaitingForResponse: true }
		);

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-waiting")).toBe(
			"true"
		);
	});

	it("derives waiting-state from graph-backed awaiting-model activity", () => {
		sessionStoreState.runtimeState = {
			connectionPhase: "connected",
			contentPhase: "loaded",
			activityPhase: "idle",
			canSubmit: true,
			canCancel: false,
			showStop: false,
			showThinking: false,
			showConnectingOverlay: false,
			showConversation: true,
			showReadyPlaceholder: false,
		};
		sessionStoreState.hotState = {
			turnState: "idle",
			status: "ready",
			currentMode: null,
			connectionError: null,
			activeTurnFailure: null,
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
		};

		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-waiting")).toBe(
			"true"
		);
	});

	it("does not report waiting-state for graph-backed running operations", () => {
		sessionStoreState.runtimeState = {
			connectionPhase: "connected",
			contentPhase: "loaded",
			activityPhase: "idle",
			canSubmit: true,
			canCancel: false,
			showStop: false,
			showThinking: false,
			showConnectingOverlay: false,
			showConversation: true,
			showReadyPlaceholder: false,
		};
		sessionStoreState.hotState = {
			turnState: "idle",
			status: "ready",
			currentMode: null,
			connectionError: null,
			activeTurnFailure: null,
			activity: {
				kind: "running_operation",
				activeOperationCount: 2,
				activeSubagentCount: 1,
				dominantOperationId: "op-2",
				blockingInteractionId: null,
			},
		};

		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-waiting")).toBe(
			"false"
		);
	});

	it("does not duplicate connection errors inside the scrollable conversation", () => {
		const view = renderContent({
			kind: "conversation",
			errorDetails: "Connection dropped while resuming session",
		});

		expect(view.getByTestId("virtualized-entry-list-stub")).toBeTruthy();
		expect(view.queryByText("Connection dropped while resuming session")).toBeNull();
	});

	it("keeps the mounted conversation list when switching sessions in conversation view", async () => {
		const view = renderContent(
			{
				kind: "conversation",
				errorDetails: null,
			},
			{
				sessionId: "session-1",
			}
		);

		const initialList = view.getByTestId("virtualized-entry-list-stub");

		await view.rerender({
			panelId: "panel-1",
			viewState: {
				kind: "conversation",
				errorDetails: null,
			},
			sessionId: "session-2",
			sessionProjectPath: null,
			allProjects: [],
			scrollContainer: null,
			scrollViewport: null,
			isAtBottom: true,
			isAtTop: true,
			isStreaming: false,
			onProjectSelected: vi.fn(),
			onRetryConnection: undefined,
			onCancelConnection: undefined,
			agentIconSrc: "",
			isFullscreen: true,
			availableAgents: [],
			effectiveTheme: "dark",
			modifiedFilesState: null,
		});

		expect(view.getByTestId("virtualized-entry-list-stub")).toBe(initialList);
	});

	it("renders VirtualizedEntryList pre-session with pending entry and isWaitingForResponse=true", () => {
		const view = renderContent(
			{ kind: "conversation", errorDetails: null },
			{
				sessionId: null,
				sceneEntries: [createUserSceneEntry("user-1", "send this")],
				isWaitingForResponse: true,
			}
		);

		const stub = view.getByTestId("virtualized-entry-list-stub");
		expect(stub).toBeTruthy();
		expect(stub.getAttribute("data-waiting")).toBe("true");
	});
});
