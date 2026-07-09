import type {
	AgentPanelPerformanceSample,
	AgentPanelSceneEntryModel,
} from "@acepe/ui/agent-panel";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	SessionGraphActivityKind,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import type { PanelViewState } from "../../../../logic/panel-visibility.js";
import type { TranscriptRowsState } from "../../../../store/transcript-rows-store.js";
import type {
	LiveSessionCanonicalProjection,
	LiveSessionWorkSource,
} from "../../../../store/live-session-work.js";
import { tick } from "svelte";

type SessionStoreMockState = {
	hotState: {
		turnState: "idle" | "running" | "completed" | "error";
		status: "idle" | "loading" | "connecting" | "ready" | "streaming" | "error";
		currentMode: null;
		connectionError: null;
		activeTurnFailure: null;
		activity: null | {
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
		};
	};
	liveProjection: LiveSessionCanonicalProjection | null;
	rowsProjection: TranscriptRowsState | null;
};

declare global {
	var __agentPanelContentSessionStoreState: SessionStoreMockState;
}

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

globalThis.__agentPanelContentSessionStoreState = {
	hotState: {
		turnState: "idle",
		status: "idle",
		currentMode: null,
		connectionError: null,
		activeTurnFailure: null,
		activity: null,
	},
	liveProjection: null,
	rowsProjection: null,
};

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
		presentation: {
			getSessionLiveWorkSource: (
				sessionId: string | null,
				_active: boolean
			): LiveSessionWorkSource => {
				if (sessionId === null) {
					return { kind: "no_session" };
				}

				const liveProjection = globalThis.__agentPanelContentSessionStoreState.liveProjection;
				if (liveProjection === null) {
					return {
						kind: "missing_canonical",
						sessionId,
					};
				}

				return {
					kind: "canonical",
					projection: liveProjection,
				};
			},
			getSessionOperationInteractionSnapshot: () => ({
				pendingQuestion: null,
				pendingQuestionOperation: null,
				pendingPermission: null,
				pendingPermissionOperation: null,
				pendingPlanApproval: null,
				pendingPlanApprovalOperation: null,
			}),
		},
		read: {
			getSessionCurrentModeId: () => null,
		},
		viewport: {
			getRowsProjection: () => globalThis.__agentPanelContentSessionStoreState.rowsProjection,
		},
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

vi.mock("../../project-selection-panel.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../ready-to-assist-placeholder.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../scene-content-viewport.svelte", async () => ({
	default: (await import("./fixtures/virtualized-entry-list-stub.svelte")).default,
}));

import AgentPanelContent from "../agent-panel-content.svelte";

function createCanonicalProjection(
	activityKind: SessionGraphActivityKind
): LiveSessionCanonicalProjection {
	return {
		lifecycle: {
			status: "ready",
			errorMessage: null,
			detachedReason: null,
			failureReason: null,
			actionability: {
				canSend: true,
				canResume: false,
				canRetry: false,
				canArchive: true,
				canConfigure: true,
				recommendedAction: "send",
				recoveryPhase: "none",
				compactStatus: "ready",
			},
		},
		activity: {
			kind: activityKind,
			activeOperationCount: activityKind === "running_operation" ? 2 : 0,
			activeSubagentCount: activityKind === "running_operation" ? 1 : 0,
			dominantOperationId: activityKind === "running_operation" ? "op-2" : null,
			blockingInteractionId: null,
		},
		turnState: activityKind === "idle" ? "Idle" : "Running",
		activeTurnFailure: null,
	};
}

function createUserSceneEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return { id, type: "user", text };
}

function createViewportRow(rowId: string): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind: "user",
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "user",
			segments: [{ kind: "text", segmentId: `${rowId}:segment:0`, text: rowId }],
		},
		durationStartedAtMs: null,
	};
}

function createRowsProjection(
	sessionId: string,
	rows: readonly TranscriptViewportRow[]
): TranscriptRowsState {
	const byId = new Map<string, TranscriptViewportRow>();
	const order: string[] = [];
	for (const row of rows) {
		order.push(row.rowId);
		byId.set(row.rowId, row);
	}
	return {
		sessionId,
		emissionSeq: rows.length,
		order,
		byId,
		rows,
	};
}

function renderContent(
	viewState: PanelViewState,
	overrides?: {
		sessionId?: string | null;
		sceneEntries?: readonly AgentPanelSceneEntryModel[];
		rowsProjectionOverride?: TranscriptRowsState | null;
	}
) {
	return render(AgentPanelContent, {
		panelId: "panel-1",
		viewState,
		sessionId: overrides?.sessionId !== undefined ? overrides.sessionId : "session-1",
		sceneEntries: overrides?.sceneEntries,
		rowsProjectionOverride: overrides?.rowsProjectionOverride,
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
	});
}

function performanceCaptureWindow(): AgentPanelPerformanceCaptureWindow {
	return window as AgentPanelPerformanceCaptureWindow;
}

describe("AgentPanelContent", () => {
	afterEach(() => {
		cleanup();
		globalThis.__agentPanelContentSessionStoreState.hotState = {
			turnState: "idle",
			status: "idle",
			currentMode: null,
			connectionError: null,
			activeTurnFailure: null,
			activity: null,
		};
		globalThis.__agentPanelContentSessionStoreState.liveProjection = null;
		globalThis.__agentPanelContentSessionStoreState.rowsProjection = null;
	});

	it("renders the virtualized conversation list for active sessions", () => {
		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub")).toBeTruthy();
	});

	it("passes the error turn state when no canonical session projection is available", () => {
		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-turn-state")).toBe(
			"error"
		);
	});

	it("derives streaming turn state from graph-backed awaiting-model activity", () => {
		globalThis.__agentPanelContentSessionStoreState.liveProjection =
			createCanonicalProjection("awaiting_model");

		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-turn-state")).toBe(
			"streaming"
		);
	});

	it("passes streaming turn state for graph-backed running operations", () => {
		globalThis.__agentPanelContentSessionStoreState.liveProjection =
			createCanonicalProjection("running_operation");

		const view = renderContent({ kind: "conversation", errorDetails: null });

		expect(view.getByTestId("virtualized-entry-list-stub").getAttribute("data-turn-state")).toBe(
			"streaming"
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

	it("renders SceneContentViewport pre-session with a pending entry", () => {
		const view = renderContent(
			{ kind: "conversation", errorDetails: null },
			{
				sessionId: null,
				sceneEntries: [createUserSceneEntry("user-1", "send this")],
			}
		);

		const stub = view.getByTestId("virtualized-entry-list-stub");
		expect(stub).toBeTruthy();
		expect(stub.getAttribute("data-turn-state")).toBe("idle");
	});

	it("prefers rowsProjectionOverride over session store rows", () => {
		globalThis.__agentPanelContentSessionStoreState.rowsProjection = createRowsProjection(
			"session-1",
			[createViewportRow("store-row")]
		);

		const view = renderContent(
			{ kind: "conversation", errorDetails: null },
			{
				rowsProjectionOverride: createRowsProjection("session-1", [
					createViewportRow("override-row-1"),
					createViewportRow("override-row-2"),
				]),
			}
		);

		expect(view.getByTestId("virtualized-entry-list-stub").dataset.rowCount).toBe("2");
	});
});
