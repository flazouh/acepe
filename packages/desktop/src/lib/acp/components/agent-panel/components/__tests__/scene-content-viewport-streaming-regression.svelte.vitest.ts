import { cleanup, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
	AgentPanelSceneEntryModel,
	TokenRevealCss,
} from "@acepe/ui/agent-panel";

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

type QueuedAnimationFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedAnimationFrames: QueuedAnimationFrame[] = [];
let nextAnimationFrameId = 1;

async function flushAnimationFrames(frameCount = 1): Promise<void> {
	for (let index = 0; index < frameCount; index += 1) {
		const frame = queuedAnimationFrames.shift();
		if (!frame) {
			break;
		}
		frame.callback(index * 16);
		await Promise.resolve();
	}
	await tick();
}

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

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@tanstack/svelte-virtual", async () =>
	await import("./fixtures/tanstack-virtual-stub.js")
);

vi.mock("mode-watcher", () => ({
	mode: { current: "dark" },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("$lib/components/theme/context.svelte.js", () => ({
	useTheme: () => ({ effectiveTheme: "dark" }),
}));

vi.mock("$lib/acp/store/chat-preferences-store.svelte.js", () => ({
	getChatPreferencesStore: () => ({ streamingAnimationMode: "smooth" }),
}));

vi.mock("$lib/acp/utils/worker-pool-singleton.js", () => ({
	getWorkerPool: () => null,
}));

vi.mock("$lib/acp/utils/pierre-diffs-theme.js", () => ({
	pierreDiffsUnsafeCSS: "",
	registerCursorThemeForPierreDiffs: vi.fn(),
}));

vi.mock("$lib/acp/services/git-status-cache.svelte.js", () => ({
	gitStatusCache: {
		getProjectGitStatusSummaryMap: () => ({
			match: () => Promise.resolve(undefined),
		}),
	},
}));

vi.mock("$lib/acp/services/github-service.js", () => ({
	getRepoContext: () => ({
		match: () => Promise.resolve(undefined),
	}),
}));

vi.mock("$lib/acp/store/index.js", () => ({
	getPanelStore: () => ({
		openFilePanel: vi.fn(),
	}),
}));

vi.mock("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		isLevelEnabled: vi.fn().mockReturnValue(false),
	}),
}));

vi.mock("../../../messages/mermaid-diagram.svelte", async () => ({
	default: (await import("./fixtures/user-message-stub.svelte")).default,
}));

import SceneContentViewport from "../scene-content-viewport.svelte";

describe("SceneContentViewport streaming regression", () => {
	beforeEach(() => {
		queuedAnimationFrames = [];
		nextAnimationFrameId = 1;
		vi.stubGlobal("ResizeObserver", class {
			observe(): void {}
			disconnect(): void {}
		});
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		});
	});

	afterEach(() => {
		cleanup();
		queuedAnimationFrames = [];
		vi.unstubAllGlobals();
	});

	it("keeps a visible assistant prefix when thinking-only updates into first-token on healthy TanStack Virtual", async () => {
		const view = render(SceneContentViewport, {
			panelId: "panel-1",
			sceneEntries: [createUserSceneEntry("user-1", "Explain umbrellas slowly.")],
			turnState: "streaming",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});

		await flushAnimationFrames(4);
		await tick();
		await tick();

		expect(view.queryByTestId("transcript-virtualizer")).not.toBeNull();
		expect(view.queryByTestId("native-fallback")).toBeNull();

		await view.rerender({
			panelId: "panel-1",
			sceneEntries: [
				createUserSceneEntry("user-1", "Explain umbrellas slowly."),
				createAssistantSceneEntry("assistant-1", "Umbrellas", true, {
					revealCount: 1,
					revealedCharCount: "Umbrellas".length,
					baselineMs: -32,
					tokStepMs: 32,
					tokFadeDurMs: 420,
					mode: "smooth",
				}),
			],
			turnState: "streaming",
			isWaitingForResponse: true,
			projectPath: undefined,
			sessionId: "session-1",
			isFullscreen: false,
			onNearBottomChange: undefined,
		});

		await flushAnimationFrames(6);
		await tick();
		await tick();

		const assistantRow = view.container.querySelector('[data-entry-key="assistant-1"]');
		expect(assistantRow).not.toBeNull();

		await waitFor(() => {
			expect(assistantRow?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
			expect(assistantRow?.textContent ?? "").toContain("Umb");
		});
	});
});
