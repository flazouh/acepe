import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import type { TranscriptRowsState } from "../../../store/transcript-rows-store.js";

const mocks = vi.hoisted(() => ({
	ensureRowsBootstrap: vi.fn<(sessionId: string) => void>(),
	requestOlderRows: vi.fn<(sessionId: string) => void>(),
}));

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui/icon-context", () => ({
	setIconConfig: () => undefined,
}));

vi.mock("@acepe/ui/agent-panel", async () => ({
	MessageScroller: (await import("./__tests__/fixtures/message-scroller-stub.svelte")).default,
	measureAgentPanelPerformance: <Value>(
		_recorder: object | null | undefined,
		_sample: object,
		run: () => Value
	): Value => run(),
	rowEstimatePx: (kind: string) => {
		if (kind === "user") {
			return 20;
		}
		if (kind === "tool") {
			return 100;
		}
		return 48;
	},
}));

vi.mock("../../../store/session-store.svelte.js", () => ({
	getSessionStore: () => ({
		viewport: {
			ensureRowsBootstrap: mocks.ensureRowsBootstrap,
			requestOlderRows: mocks.requestOlderRows,
			getRowsDiagnostics: () => null,
		},
	}),
}));

vi.mock("../../../store/permission-store.svelte.js", () => ({
	getPermissionStore: () => ({
		getForToolCall: () => null,
	}),
}));

vi.mock("../../../store/chat-preferences-store.svelte.js", () => ({
	getChatPreferencesStore: () => ({
		streamingAnimationMode: "none",
	}),
}));

vi.mock("../../../utils/worker-pool-singleton.js", () => ({
	getWorkerPool: () => null,
}));

vi.mock("../../../utils/pierre-diffs-theme.js", () => ({
	pierreDiffsUnsafeCSS: "",
	registerCursorThemeForPierreDiffs: () => undefined,
}));

vi.mock("../../../components/theme/context.svelte.js", () => ({
	useTheme: () => ({
		effectiveTheme: "dark",
	}),
}));

vi.mock("../../messages/content-block-router.svelte", async () => ({
	default: (await import("./__tests__/fixtures/user-message-stub.svelte")).default,
}));

vi.mock("./transcript-viewport-row-renderer.svelte", async () => ({
	default: (await import("./__tests__/fixtures/user-message-stub.svelte")).default,
}));

import SceneContentViewport from "./scene-content-viewport.svelte";

function createRowsProjection(
	sessionId: string,
	overrides: {
		readonly loadedStartRowIndex?: number | null;
		readonly loadedEndRowIndex?: number | null;
		readonly totalRowCount?: number | null;
		readonly rows?: readonly TranscriptViewportRow[];
	} = {}
): TranscriptRowsState {
	const rows = overrides.rows ?? [];
	const byId = new Map<string, TranscriptViewportRow>();
	for (const row of rows) {
		byId.set(row.rowId, row);
	}
	return {
		sessionId,
		emissionSeq: 0,
		revision: null,
		projectionVersion: null,
		totalRowCount: overrides.totalRowCount ?? null,
		loadedStartRowIndex: overrides.loadedStartRowIndex ?? null,
		loadedEndRowIndex: overrides.loadedEndRowIndex ?? null,
		order: rows.map((row) => row.rowId),
		byId,
		rows,
	};
}

function createViewportRow(
	rowId: string,
	kind: TranscriptViewportRow["kind"] = "assistantText"
): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind,
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "assistant", segments: [] },
	};
}

function renderViewport(options: {
	readonly sessionId: string | null;
	readonly rowsProjection: TranscriptRowsState | null;
	readonly skipRowsBootstrap: boolean;
}) {
	return render(SceneContentViewport, {
		panelId: "panel-1",
		sceneEntries: [],
		rowsProjection: options.rowsProjection,
		turnState: "idle",
		projectPath: undefined,
		sessionId: options.sessionId,
		skipRowsBootstrap: options.skipRowsBootstrap,
	});
}

function installAnimationFrameQueue() {
	const callbacks: FrameRequestCallback[] = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		})
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	return {
		flushFrame: () => {
			const pendingCallbacks = callbacks.splice(0, callbacks.length);
			for (const callback of pendingCallbacks) {
				callback(performance.now());
			}
		},
	};
}

describe("SceneContentViewport row bootstrap", () => {
	afterEach(() => {
		cleanup();
		mocks.ensureRowsBootstrap.mockReset();
		mocks.requestOlderRows.mockReset();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("bootstraps rows for real sessions", async () => {
		renderViewport({
			sessionId: "session-1",
			rowsProjection: null,
			skipRowsBootstrap: false,
		});

		await tick();

		expect(mocks.ensureRowsBootstrap).toHaveBeenCalledWith("session-1");
	});

	it("does not bootstrap rows when synthetic overrides are active", async () => {
		renderViewport({
			sessionId: "stress-session",
			rowsProjection: createRowsProjection("stress-session"),
			skipRowsBootstrap: true,
		});

		await tick();

		expect(mocks.ensureRowsBootstrap).not.toHaveBeenCalled();
	});

	it("passes projected rows to the scroller without preview placeholder state", async () => {
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1", {
				rows: [createViewportRow("row-1")],
			}),
			skipRowsBootstrap: false,
		});

		await tick();

		const scroller = rendered.getByTestId("message-scroller-stub");
		expect(scroller.dataset.rowCount).toBe("1");
		expect(scroller.hasAttribute("data-initial-preview")).toBe(false);
	});

	it("passes estimated leading history space to the scroller for loaded row slices", async () => {
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1", {
				loadedStartRowIndex: 3,
				loadedEndRowIndex: 5,
				totalRowCount: 10,
				rows: [createViewportRow("row-3"), createViewportRow("row-4")],
			}),
			skipRowsBootstrap: false,
		});

		await tick();

		const scroller = rendered.getByTestId("message-scroller-stub");
		expect(scroller.dataset.virtualLeadingSpacePx).toBe("144");
	});

	it("estimates unloaded history from trailing loaded rows when older rows are prepended", async () => {
		const rows: TranscriptViewportRow[] = [];
		for (let index = 0; index < 256; index += 1) {
			rows.push(createViewportRow(`old-${index}`, "user"));
		}
		for (let index = 0; index < 256; index += 1) {
			rows.push(createViewportRow(`tail-${index}`, "tool"));
		}
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1", {
				loadedStartRowIndex: 10,
				loadedEndRowIndex: 522,
				totalRowCount: 532,
				rows,
			}),
			skipRowsBootstrap: false,
		});

		await tick();

		const scroller = rendered.getByTestId("message-scroller-stub");
		expect(scroller.dataset.virtualLeadingSpacePx).toBe("1000");
	});

	it("defers the first older-row request until after first paint", async () => {
		vi.useFakeTimers();
		const animationFrames = installAnimationFrameQueue();
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1"),
			skipRowsBootstrap: false,
		});

		await fireEvent.click(rendered.getByTestId("message-scroller-stub-edge-top"));
		await tick();

		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(79);
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await tick();
		expect(mocks.requestOlderRows).toHaveBeenCalledWith("session-1");
	});

	it("falls back when requestAnimationFrame is throttled before the older-row request opens", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((_callback: FrameRequestCallback) => 1)
		);
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1"),
			skipRowsBootstrap: false,
		});

		await fireEvent.click(rendered.getByTestId("message-scroller-stub-edge-top"));
		await tick();

		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);
		await tick();

		expect(mocks.requestOlderRows).toHaveBeenCalledWith("session-1");
	});

	it("prefetches older rows near the loaded start after first paint", async () => {
		vi.useFakeTimers();
		const animationFrames = installAnimationFrameQueue();
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1", {
				loadedStartRowIndex: 256,
				loadedEndRowIndex: 512,
				totalRowCount: 512,
			}),
			skipRowsBootstrap: false,
		});

		await fireEvent.click(rendered.getByTestId("message-scroller-stub-near-loaded-start"));
		await tick();

		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(80);
		await tick();
		expect(mocks.requestOlderRows).toHaveBeenCalledWith("session-1");
	});

	it("waits for scroll settle before prefetching older rows", async () => {
		vi.useFakeTimers();
		const animationFrames = installAnimationFrameQueue();
		const rendered = renderViewport({
			sessionId: "session-1",
			rowsProjection: createRowsProjection("session-1", {
				loadedStartRowIndex: 256,
				loadedEndRowIndex: 512,
				totalRowCount: 512,
			}),
			skipRowsBootstrap: false,
		});

		await fireEvent.click(
			rendered.getByTestId("message-scroller-stub-near-loaded-start-scrolling")
		);
		await tick();

		animationFrames.flushFrame();
		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await fireEvent.click(rendered.getByTestId("message-scroller-stub-scroll-settled"));
		await tick();

		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		animationFrames.flushFrame();
		expect(mocks.requestOlderRows).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(80);
		await tick();
		expect(mocks.requestOlderRows).toHaveBeenCalledWith("session-1");
	});
});
