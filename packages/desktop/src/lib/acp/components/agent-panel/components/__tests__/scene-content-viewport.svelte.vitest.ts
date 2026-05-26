import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TokenRevealCss } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../../store/types.js";

import {
	clearHistory,
	conversationEntryHistory,
	dataLengthHistory,
	measureCalls,
	measureElementCalls,
	scrollToIndexCalls,
	setDefaultViewportSize,
	setSuppressRenderedChildren,
	setUseIndexKeys,
} from "./fixtures/transcript-virtualizer-state.js";

type ResizeObserverCallback = () => void;

class TestResizeObserver {
	readonly targets = new Set<Element>();

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}

	observe(target: Element): void {
		this.targets.add(target);
	}

	disconnect(): void {
		this.targets.clear();
	}

	trigger(): void {
		this.callback();
	}
}

const resizeObservers: TestResizeObserver[] = [];
const scrollIntoViewMock = vi.fn();
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"scrollIntoView"
);
const mockPermissionStore = vi.hoisted(() => ({
	getForToolCall: vi.fn(),
}));

function createUserSceneEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return { id, type: "user", text };
}

function createAssistantSceneEntry(
	id: string,
	markdown: string,
	isStreaming = false,
	tokenRevealCss?: TokenRevealCss
): AgentPanelSceneEntryModel {
	return { id, type: "assistant", markdown, isStreaming, tokenRevealCss };
}

function createToolCallSceneEntry(id: string): AgentPanelSceneEntryModel {
	return { id, type: "tool_call", title: "tool", status: "done" };
}

function createToolCallSceneEntryWithToolCallId(
	id: string,
	toolCallId: string
): AgentPanelSceneEntryModel {
	return { id, type: "tool_call", title: "tool", status: "blocked", toolCallId };
}

function createTokenRevealCss(revealedCharCount: number): TokenRevealCss {
	return {
		revealCount: 2,
		revealedCharCount,
		baselineMs: -32,
		tokStepMs: 32,
		tokFadeDurMs: 420,
		mode: "smooth",
	};
}

function createManyUserSceneEntries(count: number): AgentPanelSceneEntryModel[] {
	const entries: AgentPanelSceneEntryModel[] = [];
	for (let index = 0; index < count; index += 1) {
		entries.push(createUserSceneEntry(`user-${index}`, `message ${index}`));
	}
	return entries;
}

function restoreHTMLElementProperty(
	property: "scrollIntoView",
	descriptor: PropertyDescriptor | undefined
): void {
	if (descriptor) {
		Object.defineProperty(HTMLElement.prototype, property, descriptor);
		return;
	}

	Reflect.deleteProperty(HTMLElement.prototype, property);
}

function renderList(props?: {
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	turnState?: TurnState;
	isWaitingForResponse?: boolean;
	sessionId?: string | null;
	pendingUserRevealRequestKey?: string | null;
}): ReturnType<typeof render> {
	return render(SceneContentViewport, {
		panelId: "panel-1",
		sceneEntries: props?.sceneEntries ?? [createUserSceneEntry("user-1", "hello")],
		turnState: props?.turnState ?? "idle",
		isWaitingForResponse: props?.isWaitingForResponse ?? false,
		projectPath: undefined,
		sessionId: props?.sessionId !== undefined ? props.sessionId : "session-1",
		isFullscreen: false,
		pendingUserRevealRequestKey: props?.pendingUserRevealRequestKey ?? null,
		onNearBottomChange: undefined,
	});
}

function triggerResizeObservers(): void {
	for (const observer of resizeObservers) {
		observer.trigger();
	}
}

function triggerResizeObserversForEntryKey(entryKey: string): void {
	for (const observer of resizeObservers) {
		for (const target of observer.targets) {
			if (!(target instanceof HTMLElement)) {
				continue;
			}
			if (target.dataset.entryKey !== entryKey) {
				continue;
			}
			observer.trigger();
			break;
		}
	}
}

function triggerResizeObserversForVirtualIndex(index: number): void {
	for (const observer of resizeObservers) {
		for (const target of observer.targets) {
			if (!(target instanceof HTMLElement)) {
				continue;
			}
			if (target.dataset.index !== String(index)) {
				continue;
			}
			observer.trigger();
			break;
		}
	}
}

type QueuedAnimationFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedAnimationFrames: QueuedAnimationFrame[] = [];
let nextAnimationFrameId = 1;

async function flushAnimationFrames(): Promise<void> {
	const queued = [...queuedAnimationFrames];
	queuedAnimationFrames = [];
	for (const frame of queued) {
		frame.callback(0);
	}
	await tick();
}

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@tanstack/svelte-virtual", async () =>
	await import("./fixtures/tanstack-virtual-stub.js")
);

vi.mock("mode-watcher", () => ({
	mode: { current: "dark" },
}));

vi.mock("../../../messages/user-message.svelte", () => {
	throw new Error("SceneContentViewport must render user rows through AgentPanelConversationEntry");
});

vi.mock("../../../messages/assistant-message.svelte", () => {
	throw new Error("SceneContentViewport must render assistant rows through AgentPanelConversationEntry");
});

vi.mock("../../../messages/content-block-router.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../../messages/mermaid-diagram.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../../messages/error-message.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

vi.mock("../../../tool-calls/permission-bar.svelte", async () => ({
	default: (await import("./fixtures/permission-bar-stub.svelte")).default,
}));

vi.mock("../../../../store/permission-store.svelte.js", () => ({
	getPermissionStore: () => mockPermissionStore,
}));

vi.mock("@acepe/ui/agent-panel", async () => ({
	AgentPanelConversationEntry: (await import("./fixtures/agent-panel-conversation-entry-stub.svelte")).default,
	groupAssistantChunks: (chunks: { type: string; block?: { type: string; text?: string } }[]) => ({
		thoughtGroups: [],
		messageGroups: chunks
			.filter((chunk) => chunk.type === "message" && chunk.block?.type === "text")
			.map((chunk) => ({ type: "text" as const, text: chunk.block?.text ?? "" })),
	}),
}));

vi.mock("@acepe/ui/icon-context", () => ({
	setIconConfig: vi.fn(),
}));

vi.mock("@acepe/ui", async () => ({
	AgentPanelConversationEntry: (await import("./fixtures/agent-panel-conversation-entry-stub.svelte")).default,
	AgentPanelSceneEntry: (await import("./fixtures/user-message-stub.svelte")).default,
	setIconConfig: vi.fn(),
	TextShimmer: (await import("./fixtures/user-message-stub.svelte")).default,
}));

import SceneContentViewport from "../scene-content-viewport.svelte";

describe("SceneContentViewport auto-scroll", () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		clearHistory();
		mockPermissionStore.getForToolCall.mockReset();
		mockPermissionStore.getForToolCall.mockReturnValue(undefined);
		queuedAnimationFrames = [];
		nextAnimationFrameId = 1;
		scrollIntoViewMock.mockClear();
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		});
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoViewMock,
		});
	});

	afterEach(() => {
		cleanup();
		resizeObservers.length = 0;
		queuedAnimationFrames = [];
		vi.unstubAllGlobals();
		restoreHTMLElementProperty("scrollIntoView", originalScrollIntoViewDescriptor);
	});

	it("mounts with empty TanStack Virtual data before hydrating restored entries on the next frame", async () => {
		renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await tick();

		expect(dataLengthHistory).toContain(0);

		await flushAnimationFrames();

		expect(dataLengthHistory).toContain(2);
		expect(dataLengthHistory.indexOf(0)).toBeLessThan(dataLengthHistory.indexOf(2));
	});

	it("does not run the delayed historical bottom reveal after the user scrolls away", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await tick();
		await flushAnimationFrames();
		await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		scrollToIndexCalls.length = 0;
		await fireEvent.wheel(viewport, { deltaY: -100 });
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();

		expect(scrollToIndexCalls).toHaveLength(0);
	});

	it("does not crash when a scheduled scroll flush runs after TanStack Virtual unmounts", async () => {
		const view = renderList({
			sceneEntries: createManyUserSceneEntries(3),
			turnState: "streaming",
			isWaitingForResponse: true,
		});

		view.unmount();

		await expect(flushAnimationFrames()).resolves.toBeUndefined();
	});

	it("switches sessions without re-entering empty hydration and still reveals the latest entry", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
			sessionId: "session-1",
		});
		await tick();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();

		dataLengthHistory.length = 0;
		scrollToIndexCalls.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createUserSceneEntry("user-3", "next"), createUserSceneEntry("user-4", "session")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-2",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();

		expect(dataLengthHistory).not.toContain(0);
		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 1,
			options: { align: "end" },
		});
	});

	it("keeps TanStack Virtual mounted when it never reports a viewport", async () => {
		setDefaultViewportSize(0);

		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("keeps TanStack Virtual mounted when it renders no entry nodes", async () => {
		setSuppressRenderedChildren(true);

		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await tick();

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("recovers rendered rows after a delayed no-render probe without switching renderers", async () => {
		setSuppressRenderedChildren(true);

		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await tick();

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		setSuppressRenderedChildren(false);
		for (let i = 0; i < 4; i += 1) {
			await flushAnimationFrames();
		}
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("does not let a stale no-render probe switch the next session into fallback", async () => {
		setSuppressRenderedChildren(true);

		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "old")],
			sessionId: "session-1",
		});
		await tick();
		await flushAnimationFrames();

		setSuppressRenderedChildren(false);

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createUserSceneEntry("user-2", "new")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-2",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}
		await tick();

		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
	});

	it("renders user entries via TanStack Virtual", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const stubs = view.container.querySelectorAll("[data-testid='agent-panel-conversation-entry-stub']");
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});

	it("routes user, assistant, tool, and thinking rows through AgentPanelConversationEntry", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "world"),
				createToolCallSceneEntry("tool-1"),
				{ id: "missing-1", type: "missing", diagnosticLabel: "missing-1" },
			],
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(conversationEntryHistory.map((entry) => entry.type)).toEqual([
			"user",
			"assistant",
			"tool_call",
			"missing",
			"thinking",
		]);
		expect(conversationEntryHistory[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
		});
	});

	it("attaches permission shelf without replacing the tool card right edge", async () => {
		mockPermissionStore.getForToolCall.mockReturnValue({
			id: "permission-1",
			sessionId: "session-1",
			permission: "Execute",
			patterns: [],
			metadata: { options: [] },
			always: [],
			tool: { messageID: "", callID: "tool-call-1" },
		});

		const view = renderList({
			sceneEntries: [createToolCallSceneEntryWithToolCallId("tool-entry-1", "tool-call-1")],
			turnState: "streaming",
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("permission-bar-stub")).not.toBeNull();
		expect(view.queryByTestId("tool-call-permission-main-edge")).toBeNull();

		const card = view.container.querySelector(".agent-tool-card");
		if (!(card instanceof HTMLElement)) {
			throw new Error("Missing tool card");
		}

		expect(card.closest(".tool-call-with-permission")).not.toBeNull();
	});

	it("keeps compact settled tool transcripts in TanStack Virtual", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createToolCallSceneEntry("tool-1"),
				createAssistantSceneEntry("assistant-1", "done"),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("keeps a live assistant row in healthy TanStack Virtual when the global turn state is idle", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "streaming response", true),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			isStreaming: true,
		});
	});

	it("reveals the latest row when streaming stays on healthy TanStack Virtual", async () => {
		const initialEntries = createManyUserSceneEntries(12);
		const view = renderList({
			sceneEntries: initialEntries,
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		scrollIntoViewMock.mockClear();

		const streamingEntries = createManyUserSceneEntries(12);
		streamingEntries.push(
			createAssistantSceneEntry("assistant-live", "streaming response", true)
		);

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: streamingEntries,
			turnState: "streaming",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await tick();

		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 13,
			options: { align: "end" },
		});
	});

	it("keeps a token-animating assistant row in healthy TanStack Virtual after canonical streaming completes", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry(
					"assistant-1",
					"completed response",
					false,
					createTokenRevealCss("completed response".length)
				),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			isStreaming: false,
			tokenRevealCss: createTokenRevealCss("completed response".length),
		});
	});

	it("keeps primary rendering after token timing settles while the thread is following", async () => {
		const activeTokenRevealCss = createTokenRevealCss("completed response".length);
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry(
					"assistant-1",
					"completed response",
					false,
					activeTokenRevealCss
				),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "completed response", false),
			],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("returns to TanStack Virtual after settled token timing when the user detaches from follow", async () => {
		const activeTokenRevealCss = createTokenRevealCss("completed response".length);
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry(
					"assistant-1",
					"completed response",
					false,
					activeTokenRevealCss
				),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "completed response", false),
			],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();
		await tick();

		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
	});

	it("keeps primary rendering when a live assistant completes before token timing clears", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createToolCallSceneEntry("tool-1"),
				createAssistantSceneEntry("assistant-1", "streaming response", true),
			],
			turnState: "streaming",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createToolCallSceneEntry("tool-1"),
				createAssistantSceneEntry(
					"assistant-1",
					"completed response",
					false,
					createTokenRevealCss("completed response".length)
				),
			],
			turnState: "completed",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("keeps TanStack Virtual rows keyed by entry id during data churn", async () => {
		const view = renderList({
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "first"),
				createAssistantSceneEntry("assistant-2", "second"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-2", "second")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.container.querySelector('[data-entry-key="assistant-2"]')).not.toBeNull();
		expect(view.container.querySelector('[data-entry-key="assistant-1"]')).toBeNull();
	});

	it("renders TanStack Virtual rows from the current display entry indexes", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createUserSceneEntry("user-2", "world")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-2",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.container.querySelector('[data-entry-key="user-1"]')).not.toBeNull();
		expect(view.container.querySelector('[data-entry-key="user-2"]')).not.toBeNull();
	});

	it("keeps mounted assistant rows stable when TanStack Virtual clears their item during teardown", async () => {
		setUseIndexKeys(true);

		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "first")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("agent-panel-conversation-entry-stub")).not.toBeNull();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "first")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
	});

	it("appends thinking indicator when waiting for response", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello")],
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		// The thinking entry is appended to displayEntries when isWaitingForResponse is true
		// It renders through the shared conversation entry stub.
		const stubs = view.container.querySelectorAll("[data-testid='agent-panel-conversation-entry-stub']");
		// user entry + thinking entry = at least 2 stubs
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});

	it("keeps healthy TanStack Virtual mounted when waiting appends the thinking indicator", async () => {
		const view = renderList({
			sceneEntries: createManyUserSceneEntries(12),
			turnState: "idle",
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			type: "thinking",
		});
	});

	it("keeps TanStack Virtual mounted for very long sessions with a zero viewport probe", async () => {
		setDefaultViewportSize(0);

		const view = renderList({
			sceneEntries: createManyUserSceneEntries(250),
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("keeps TanStack Virtual mounted with the shared long-session fixture", async () => {
		setDefaultViewportSize(0);
		const longSessionEntries = createManyUserSceneEntries(320);

		const view = renderList({
			sceneEntries: longSessionEntries,
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("does not steal scroll control back when the user has detached", async () => {
		const view = renderList();
		await flushAnimationFrames();
		await tick();
		await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		scrollToIndexCalls.length = 0;

		// Simulate user scroll to detach from auto-follow
		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();
		triggerResizeObservers();
		await tick();

		expect(scrollToIndexCalls).toHaveLength(0);
	});

	it("uses send as an explicit follow override after the user detached", async () => {
		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		scrollToIndexCalls.length = 0;

		// Simulate user scroll to detach
		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();

		// Request user reveal (simulates sending a message) after the user detached.
		view.component.prepareForNextUserReveal({ force: true });

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createUserSceneEntry("user-1", "sent")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();

		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 1,
			options: { align: "end" },
		});
	});

	it("reveals a pending send request when the optimistic user row appears later", async () => {
		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();

		scrollToIndexCalls.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createUserSceneEntry("optimistic-user-1", "sent")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			pendingUserRevealRequestKey: "send-1",
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();

		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 1,
			options: { align: "end" },
		});
	});

	it("reveals the waiting tail when a pending send request reaches the mounted optimistic row", async () => {
		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();

		scrollToIndexCalls.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createUserSceneEntry("optimistic-user-1", "sent")],
			turnState: "idle",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			pendingUserRevealRequestKey: "send-1",
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();

		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 2,
			options: { align: "end" },
		});
	});

		it("reveals the trailing thinking indicator after a user message is sent", async () => {
			const view = renderList({
				sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
			});
			await flushAnimationFrames();
			await tick();
			await tick();

			scrollToIndexCalls.length = 0;

			view.component.prepareForNextUserReveal({ force: true });

			await view.rerender({
				panelId: "panel-1",
				sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createUserSceneEntry("user-1", "sent")],
				turnState: "idle",
				isWaitingForResponse: true,
				projectPath: undefined,
				sessionId: "session-1",
				isFullscreen: false,
				onNearBottomChange: undefined,
			});
			await tick();
			await flushAnimationFrames();

			expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
			expect(view.queryByTestId("native-fallback")).toBeNull();
			expect(conversationEntryHistory.at(-1)).toMatchObject({
				type: "thinking",
			});
		});

		it("keeps the trailing thinking indicator visible when the sent user row resizes", async () => {
			const view = renderList({
				sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
			});
			await flushAnimationFrames();
			await tick();
			await tick();

			view.component.prepareForNextUserReveal({ force: true });

			await view.rerender({
				panelId: "panel-1",
				sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createUserSceneEntry("user-1", "sent")],
				turnState: "idle",
				isWaitingForResponse: true,
				projectPath: undefined,
				sessionId: "session-1",
				isFullscreen: false,
				onNearBottomChange: undefined,
			});
			await tick();
			await flushAnimationFrames();

			scrollToIndexCalls.length = 0;
			triggerResizeObserversForEntryKey("user-1");
			await flushAnimationFrames();
			await flushAnimationFrames();

			expect(scrollToIndexCalls.at(-1)).toEqual({
				index: 2,
				options: { align: "end" },
			});
		});

		it("does not force-follow a non-user latest update after the user detached", async () => {
			const view = renderList({
				sceneEntries: [createAssistantSceneEntry("assistant-1", "first")],
			});
			await flushAnimationFrames();
			await tick();
			await tick();

		const viewport = view.container.firstElementChild;
		if (!(viewport instanceof HTMLElement)) {
			throw new Error("Missing viewport element");
		}

		scrollToIndexCalls.length = 0;

		// Simulate user scroll to detach
		await fireEvent.wheel(viewport, { deltaY: -100 });
		await fireEvent.scroll(viewport);
		await flushAnimationFrames();

		// Re-render with updated assistant content (no force reveal requested)
		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "second")],
			turnState: "idle",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();

		expect(scrollToIndexCalls).toHaveLength(0);
	});

	it("switches sessions while waiting without staying empty and reveals the new thinking tail", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "hello"), createAssistantSceneEntry("assistant-1", "world")],
			isWaitingForResponse: true,
			sessionId: "session-1",
		});
		await tick();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();

		dataLengthHistory.length = 0;
		scrollToIndexCalls.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createUserSceneEntry("user-2", "new"), createAssistantSceneEntry("assistant-2", "session")],
			turnState: "idle",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-2",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();
		await flushAnimationFrames();
		await flushAnimationFrames();

		expect(dataLengthHistory).not.toContain(0);
		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			type: "thinking",
		});
	});

	it("renders tool call entries", async () => {
		const view = renderList({
			sceneEntries: [createToolCallSceneEntry("tool-1")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		// Tool calls render via AgentPanelConversationEntry.
		const stubs = view.container.querySelectorAll("[data-testid='agent-panel-conversation-entry-stub']");
		expect(stubs.length).toBeGreaterThanOrEqual(1);
	});

	it("reveals a growing tool call while the thinking indicator trails it", async () => {
		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest")],
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();
		await tick();

		scrollToIndexCalls.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [createAssistantSceneEntry("assistant-1", "latest"), createToolCallSceneEntry("tool-1")],
			turnState: "idle",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		triggerResizeObserversForEntryKey("tool-1");
		await flushAnimationFrames();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(scrollToIndexCalls.at(-1)).toEqual({
			index: 2,
			options: { align: "end" },
		});
	});

	it("observes resize only for the latest reveal target", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "latest"),
				createToolCallSceneEntry("tool-1"),
			],
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const observedTargets = resizeObservers.flatMap((observer) => Array.from(observer.targets));
		const observedEntryKeys = observedTargets
			.filter((target): target is HTMLElement => target instanceof HTMLElement)
			.map((target) => target.dataset.entryKey)
			.filter((entryKey): entryKey is string => entryKey !== undefined);

		expect(observedEntryKeys).toEqual(["tool-1"]);
	});

	it("registers mounted rows with TanStack measurement", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "world"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();
		await flushAnimationFrames();

		expect(measureElementCalls).toEqual(expect.arrayContaining(["0", "1"]));
		expect(measureCalls).toHaveLength(0);
	});

	it("remeasures a virtual row when its rendered height changes after mount", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createToolCallSceneEntry("tool-1"),
				createAssistantSceneEntry("assistant-1", "world"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		measureCalls.length = 0;
		measureElementCalls.length = 0;
		triggerResizeObserversForVirtualIndex(1);
		await flushAnimationFrames();

		expect(measureElementCalls).toEqual(expect.arrayContaining(["1"]));
		expect(measureCalls).toHaveLength(0);
	});

	it("registers tool and assistant rows with TanStack dynamic measurement", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createToolCallSceneEntry("tool-1"),
				createAssistantSceneEntry("assistant-1", "world"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();
		await flushAnimationFrames();

		expect(measureElementCalls).toEqual(expect.arrayContaining(["0", "1", "2"]));
		expect(measureCalls).toHaveLength(0);
	});

	it("tracks last assistant id for streaming indicator", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "response", true),
			],
			turnState: "streaming",
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		// Re-render with a second assistant entry to verify tracking updates
		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "response", true),
				createAssistantSceneEntry("assistant-2", "another response", true),
			],
			turnState: "streaming",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(conversationEntryHistory.at(-1)).toMatchObject({
			id: "assistant-2",
			type: "assistant",
			isStreaming: true,
		});
	});

	it("resets assistant streaming tracking when switching to a same-length session", async () => {
		const initialEntries = [
			createUserSceneEntry("old-user-1", "old one"),
			createUserSceneEntry("old-user-2", "old two"),
			createAssistantSceneEntry("old-assistant", "old response", true),
		];
		const nextEntries = [
			createUserSceneEntry("new-user-1", "new one"),
			createUserSceneEntry("new-user-2", "new two"),
			createAssistantSceneEntry("new-assistant", "new response", true),
		];
		const view = renderList({
			sceneEntries: initialEntries,
			turnState: "streaming",
			sessionId: "session-1",
		});
		await flushAnimationFrames();
		await tick();
		await tick();
		conversationEntryHistory.length = 0;

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: nextEntries,
			turnState: "streaming",
			isWaitingForResponse: false,
			projectPath: undefined,
			sessionId: "session-2",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();

		expect(conversationEntryHistory.find((entry) => entry.id === "new-assistant")).toMatchObject({
			id: "new-assistant",
			type: "assistant",
			isStreaming: true,
		});
	});

	it("provides scrollToBottom export", async () => {
		const view = renderList();
		await flushAnimationFrames();
		await tick();
		await tick();

		// scrollToBottom delegates to a typed viewport controller command.
		expect(typeof view.component.scrollToBottom).toBe("function");
		// Should not throw
		view.component.scrollToBottom();
		view.component.scrollToBottom({ force: true });
	});

	it("renders scene entries without crash when sessionId is null (pre-session)", async () => {
		const view = renderList({
			sceneEntries: [createUserSceneEntry("user-1", "pre-session message")],
			sessionId: null,
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const stubs = view.container.querySelectorAll("[data-testid='agent-panel-conversation-entry-stub']");
		// user entry + thinking entry = at least 2 stubs
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});
});
