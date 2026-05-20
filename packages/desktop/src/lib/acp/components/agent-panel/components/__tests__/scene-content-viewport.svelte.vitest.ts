import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnState } from "../../../../store/types.js";

import {
	clearHistory,
	conversationEntryHistory,
	dataLengthHistory,
	getCurrentScrollOffset,
	renderedItemHistory,
	scrollToIndexCalls,
	setDefaultViewportSize,
	setSuppressRenderedChildren,
	setUndefinedRenderedIndexes,
	setUseIndexKeys,
} from "./fixtures/vlist-stub-state.js";

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
}): ReturnType<typeof render> {
	return render(SceneContentViewport, {
		panelId: "panel-1",
		sceneEntries: props?.sceneEntries ?? [createUserSceneEntry("user-1", "hello")],
		turnState: props?.turnState ?? "idle",
		isWaitingForResponse: props?.isWaitingForResponse ?? false,
		projectPath: undefined,
		sessionId: props?.sessionId !== undefined ? props.sessionId : "session-1",
		isFullscreen: false,
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

vi.mock("virtua/svelte", async () => ({
	VList: (await import("./fixtures/vlist-stub.svelte")).default,
}));

vi.mock("mode-watcher", () => ({
	mode: { current: "dark" },
}));

vi.mock("../../../messages/user-message.svelte", () => {
	throw new Error("SceneContentViewport must render user rows through AgentPanelConversationEntry");
});

vi.mock("../../../messages/assistant-message.svelte", () => {
	throw new Error(
		"SceneContentViewport must render assistant rows through AgentPanelConversationEntry"
	);
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

vi.mock("@acepe/ui/agent-panel", async () => ({
	AgentPanelConversationEntry: (
		await import("./fixtures/agent-panel-conversation-entry-stub.svelte")
	).default,
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
	AgentPanelConversationEntry: (
		await import("./fixtures/agent-panel-conversation-entry-stub.svelte")
	).default,
	AgentPanelSceneEntry: (await import("./fixtures/user-message-stub.svelte")).default,
	setIconConfig: vi.fn(),
	TextShimmer: (await import("./fixtures/user-message-stub.svelte")).default,
}));

import SceneContentViewport from "../scene-content-viewport.svelte";

describe("SceneContentViewport auto-scroll", () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		clearHistory();
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

	it("mounts with empty VList data before hydrating restored entries on the next frame", async () => {
		renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await tick();

		expect(dataLengthHistory).toContain(0);

		await flushAnimationFrames();

		expect(dataLengthHistory).toContain(2);
		expect(dataLengthHistory.indexOf(0)).toBeLessThan(dataLengthHistory.indexOf(2));
	});

	it("does not run the delayed historical bottom reveal after the user scrolls away", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
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

	it("does not crash when a scheduled scroll flush runs after VList unmounts", async () => {
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
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
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
			sceneEntries: [
				createUserSceneEntry("user-3", "next"),
				createUserSceneEntry("user-4", "session"),
			],
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

	it("falls back to a native scroll container when Virtua never reports a viewport", async () => {
		setDefaultViewportSize(0);

		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("native-fallback")).not.toBeNull();
		expect(view.queryByTestId("vlist-stub")).toBeNull();

		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});

	it("falls back to a native scroll container when Virtua renders no entry nodes", async () => {
		setSuppressRenderedChildren(true);

		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await tick();

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("native-fallback")).not.toBeNull();
		expect(view.queryByTestId("vlist-stub")).toBeNull();
	});

	it("recovers from a delayed no-render fallback instead of staying permanently native", async () => {
		setSuppressRenderedChildren(true);

		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await tick();

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("native-fallback")).not.toBeNull();

		setSuppressRenderedChildren(false);
		for (let i = 0; i < 4; i += 1) {
			await flushAnimationFrames();
		}
		await tick();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
	});

	it("renders user entries via Virtua VList", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
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

	it("uses the native scroller for compact settled tool transcripts", async () => {
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

		expect(view.queryByTestId("native-fallback")).not.toBeNull();
		expect(view.queryByTestId("vlist-stub")).toBeNull();
	});

	it("keeps a live assistant row in healthy Virtua when the global turn state is idle", async () => {
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			isStreaming: true,
		});
	});

	it("reveals the latest row when streaming stays on healthy Virtua", async () => {
		const initialEntries = createManyUserSceneEntries(12);
		const view = renderList({
			sceneEntries: initialEntries,
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		scrollIntoViewMock.mockClear();

		const streamingEntries = createManyUserSceneEntries(12);
		streamingEntries.push(createAssistantSceneEntry("assistant-live", "streaming response", true));

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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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

	it("keeps a token-animating assistant row in healthy Virtua after canonical streaming completes", async () => {
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
				createAssistantSceneEntry("assistant-1", "completed response", false, activeTokenRevealCss),
			],
			turnState: "idle",
			isWaitingForResponse: false,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("returns to Virtua after settled token timing when the user detaches from follow", async () => {
		const activeTokenRevealCss = createTokenRevealCss("completed response".length);
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "completed response", false, activeTokenRevealCss),
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
	});

	it("ignores transient undefined rows from Virtua during data churn", async () => {
		const view = renderList({
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "first"),
				createAssistantSceneEntry("assistant-2", "second"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		setUndefinedRenderedIndexes([0]);

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

		expect(renderedItemHistory.some((item) => item.index === 0 && item.isUndefined)).toBe(true);
		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
		expect(stubs.length).toBe(0);
		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
	});

	it("characterizes the Virtua snippet boundary receiving undefined items", async () => {
		const view = renderList({
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		renderedItemHistory.length = 0;
		setUndefinedRenderedIndexes([1]);

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createUserSceneEntry("user-2", "world"),
			],
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

		expect(renderedItemHistory).toContainEqual({ index: 1, isUndefined: true });
	});

	it("keeps mounted assistant rows stable when Virtua clears their item during teardown", async () => {
		setUseIndexKeys(true);

		const view = renderList({
			sceneEntries: [createAssistantSceneEntry("assistant-1", "first")],
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("agent-panel-conversation-entry-stub")).not.toBeNull();

		setUndefinedRenderedIndexes([0]);

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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
		// user entry + thinking entry = at least 2 stubs
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});

	it("keeps healthy Virtua mounted when waiting appends the thinking indicator", async () => {
		const view = renderList({
			sceneEntries: createManyUserSceneEntries(12),
			turnState: "idle",
			isWaitingForResponse: true,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(conversationEntryHistory.at(-1)).toMatchObject({
			type: "thinking",
		});
	});

	it("keeps native fallback bounded for very long sessions", async () => {
		setDefaultViewportSize(0);

		const view = renderList({
			sceneEntries: createManyUserSceneEntries(250),
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("native-fallback")).not.toBeNull();
		const renderedRows = view.container.querySelectorAll("[data-entry-key]");
		expect(renderedRows.length).toBeLessThanOrEqual(80);
		expect(renderedRows[0]?.getAttribute("data-entry-key")).toBe("user-170");
		expect(renderedRows[renderedRows.length - 1]?.getAttribute("data-entry-key")).toBe("user-249");
	});

	it("keeps native fallback bounded with the shared long-session fixture", async () => {
		setDefaultViewportSize(0);
		const longSessionEntries = createManyUserSceneEntries(320);

		const view = renderList({
			sceneEntries: longSessionEntries,
		});
		await tick();

		for (let i = 0; i < 12; i += 1) {
			await flushAnimationFrames();
		}

		expect(view.queryByTestId("native-fallback")).not.toBeNull();
		const renderedRows = view.container.querySelectorAll("[data-entry-key]");
		expect(renderedRows.length).toBeLessThan(longSessionEntries.length);
		expect(renderedRows.length).toBeLessThanOrEqual(80);
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
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "latest"),
				createUserSceneEntry("user-1", "sent"),
			],
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

	it("preserves detached scroll position when retrying from native fallback back to Virtua", async () => {
		const entries = createManyUserSceneEntries(24);
		setSuppressRenderedChildren(true);
		const view = renderList({
			sceneEntries: entries,
		});
		await flushAnimationFrames();
		await tick();
		await tick();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(view.container.querySelectorAll("[data-entry-key]")).toHaveLength(0);

		let nativeFallback: Element | null = null;
		for (let i = 0; i < 8; i += 1) {
			await flushAnimationFrames();
			nativeFallback = view.container.querySelector("[data-testid='native-fallback']");
			if (nativeFallback !== null) {
				break;
			}
		}
		await tick();

		if (!(nativeFallback instanceof HTMLDivElement)) {
			throw new Error("Missing native fallback viewport");
		}

		Object.defineProperty(nativeFallback, "clientHeight", {
			configurable: true,
			value: 200,
		});
		Object.defineProperty(nativeFallback, "scrollHeight", {
			configurable: true,
			value: 2000,
		});
		nativeFallback.scrollTop = 640;

		await fireEvent.wheel(nativeFallback, { deltaY: -100 });
		await fireEvent.scroll(nativeFallback);
		await flushAnimationFrames();

		setSuppressRenderedChildren(false);

		for (let i = 0; i < 6; i += 1) {
			await flushAnimationFrames();
		}
		await tick();

		expect(view.queryByTestId("native-fallback")).toBeNull();
		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
		expect(getCurrentScrollOffset()).toBeGreaterThan(0);
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
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "latest"),
				createUserSceneEntry("user-1", "sent"),
			],
			turnState: "idle",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});
		await tick();
		await flushAnimationFrames();

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "latest"),
				createUserSceneEntry("user-1", "sent"),
			],
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
			sceneEntries: [
				createUserSceneEntry("user-1", "hello"),
				createAssistantSceneEntry("assistant-1", "world"),
			],
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
			sceneEntries: [
				createUserSceneEntry("user-2", "new"),
				createAssistantSceneEntry("assistant-2", "session"),
			],
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
		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
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
			sceneEntries: [
				createAssistantSceneEntry("assistant-1", "latest"),
				createToolCallSceneEntry("tool-1"),
			],
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

		expect(view.queryByTestId("vlist-stub")).not.toBeNull();
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
			.map((target) => target.dataset.entryKey);

		expect(observedEntryKeys).toEqual(["tool-1"]);
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

		const stubs = view.container.querySelectorAll(
			"[data-testid='agent-panel-conversation-entry-stub']"
		);
		// user entry + thinking entry = at least 2 stubs
		expect(stubs.length).toBeGreaterThanOrEqual(2);
	});
});
