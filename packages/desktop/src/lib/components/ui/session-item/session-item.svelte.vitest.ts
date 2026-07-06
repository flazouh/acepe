import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionDisplayItem } from "$lib/acp/types/thread-display-item.js";

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

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn(),
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("$lib/acp/components/agent-panel/logic/clipboard-manager.js", () => ({
	copyTextToClipboard: vi.fn(),
}));

vi.mock("$lib/utils/tauri-client/index.js", () => ({
	revealInFinder: vi.fn(),
	tauriClient: {
		shell: {
			getSessionFilePath: vi.fn(),
		},
	},
}));

vi.mock("$lib/acp/store/index.js", () => ({
	getAgentStore: () => ({
		getProviderMetadata: () => null,
	}),
	getPanelStore: () => ({
		getPanelBySessionId: () => null,
	}),
	getInteractionStore: () => ({}),
	getQuestionSelectionStore: () => ({
		clearQuestion: vi.fn(),
		clearSelections: vi.fn(),
		getAnswers: () => [],
		getOtherText: () => "",
		hasSelections: () => false,
		isOptionSelected: () => false,
		isOtherActive: () => false,
		setOtherModeActive: vi.fn(),
		setOtherText: vi.fn(),
		setSingleOption: vi.fn(),
		toggleOption: vi.fn(),
	}),
	getQuestionStore: () => ({
		reply: vi.fn(),
	}),
	getUnseenStore: () => ({
		isUnseen: () => false,
	}),
}));

vi.mock("$lib/acp/store/session-store.svelte.js", () => ({
	getSessionStore: () => ({
		presentation: {
			getSessionListItemPresentation: () => ({
				connectionError: null,
				currentModeId: null,
				currentStreamingToolCall: null,
				currentToolKind: null,
				lastTodoToolCall: null,
				lastToolCall: null,
				lastToolKind: null,
				liveSessionState: {
					attention: {
						hasUnseenCompletion: false,
					},
				},
				pendingComputerPermission: null,
				pendingPermission: null,
				pendingPlanApproval: null,
				pendingQuestion: null,
				previewActivityKind: "idle",
				sessionWorkProjection: {
					compactActivityKind: "idle",
					hasError: false,
				},
			}),
		},
	}),
}));

import SessionItem from "./session-item.svelte";

function createSession(overrides?: Partial<SessionDisplayItem>): SessionDisplayItem {
	return {
		id: "session-1",
		title: "Render session",
		agentId: "codex",
		projectPath: "/repo",
		projectName: "repo",
		createdAt: new Date("2026-05-24T08:00:00.000Z"),
		updatedAt: new Date("2026-05-24T08:10:00.000Z"),
		entryCount: 12,
		isConnected: false,
		isStreaming: false,
		projectColor: "#22c55e",
		projectIconSrc: null,
		activity: null,
		insertions: 0,
		deletions: 0,
		sequenceId: 6,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

describe("SessionItem", () => {
	it("wires the View Transcript File menu action to the Acepe file dialog callback", async () => {
		const session = createSession();
		let openedSessionId: string | null = null;

		const view = render(SessionItem, {
			thread: session,
			selected: true,
			onSelect: () => undefined,
			onOpenTranscriptInAcepe: (openedSession: SessionDisplayItem) => {
				openedSessionId = openedSession.id;
			},
		});

		await fireEvent.click(view.getByLabelText("Session actions"));
		const menuItem = await view.findByText("View Transcript File");
		await fireEvent.click(menuItem);

		await waitFor(() => {
			expect(openedSessionId).toBe(session.id);
		});
	});
});
