// Characterization net (gap-closing) for the scene-mapper decomposition.
// The sibling desktop-agent-panel-scene.test.ts covers most of the public seam;
// this file closes the paths it does not exercise directly — browser tool
// payloads, todos field population, and the worktree/install/error card
// builders — so any drift during the decomposition
// (docs/plans/2026-06-08-001-...-plan.md) fails immediately.
import { describe, expect, it } from "bun:test";
import type { SessionEntry } from "../../../application/dto/session-entry.js";
import {
	buildDesktopErrorCard,
	buildDesktopInstallCard,
	buildDesktopWorktreeCard,
	mapSessionEntriesToConversationModel,
} from "./desktop-agent-panel-scene.js";

describe("desktop agent panel scene adapter — characterization gaps", () => {
	it("maps browser tool details from the raw result when no normalized result exists", () => {
		const entries: SessionEntry[] = [
			{
				id: "browser-1",
				type: "tool_call",
				message: {
					id: "browser-1",
					name: "browser",
					arguments: { kind: "other", raw: {} },
					status: "completed",
					result: "Navigated to https://acepe.dev and captured the page",
					kind: "browser",
					title: "Browser",
					locations: null,
					skillMeta: null,
					normalizedResult: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "idle");

		expect(conversation.entries[0]).toMatchObject({
			id: "browser-1",
			type: "tool_call",
			kind: "browser",
			status: "done",
			detailsText: "Navigated to https://acepe.dev and captured the page",
		});
	});

	it("maps browser execute-js script arguments onto scriptText separately from details", () => {
		const script =
			"(() => {\n  const eds = Array.from(document.querySelectorAll('[data-ref]'));\n  return eds;\n})()";
		const entries: SessionEntry[] = [
			{
				id: "browser-script-1",
				type: "tool_call",
				message: {
					id: "browser-script-1",
					name: "mcp__tauri__webview_execute_js",
					arguments: {
						kind: "browser",
						raw: { script },
						script,
					},
					status: "in_progress",
					result: null,
					kind: "browser",
					title: "Browser",
					locations: null,
					skillMeta: null,
					normalizedResult: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "streaming");

		expect(conversation.entries[0]).toMatchObject({
			id: "browser-script-1",
			type: "tool_call",
			kind: "browser",
			scriptText: script,
			detailsText: null,
		});
	});

	it("populates todos on the scene entry from normalized todos", () => {
		const entries: SessionEntry[] = [
			{
				id: "todos-1",
				type: "tool_call",
				message: {
					id: "todos-1",
					name: "todo_write",
					arguments: { kind: "other", raw: {} },
					status: "in_progress",
					result: null,
					kind: "other",
					title: "Todos",
					locations: null,
					skillMeta: null,
					normalizedResult: null,
					normalizedQuestions: null,
					normalizedTodos: [
						{
							content: "Decompose the scene mapper",
							activeForm: "Decomposing the scene mapper",
							status: "in_progress",
							duration: null,
						},
						{
							content: "Keep tests green",
							activeForm: "Keeping tests green",
							status: "pending",
							duration: null,
						},
					],
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
				},
			},
		];

		const conversation = mapSessionEntriesToConversationModel(entries, "streaming");
		const entry = conversation.entries[0];

		expect(entry.type).toBe("tool_call");
		if (entry.type !== "tool_call") {
			throw new Error("expected tool_call entry");
		}
		expect(entry.subtitle).toBe("Decomposing the scene mapper");
		expect(entry.todos).toEqual([
			{
				content: "Decompose the scene mapper",
				activeForm: "Decomposing the scene mapper",
				status: "in_progress",
				duration: null,
			},
			{
				content: "Keep tests green",
				activeForm: "Keeping tests green",
				status: "pending",
				duration: null,
			},
		]);
	});

	it("builds worktree, install, and error cards", () => {
		const worktreeCard = buildDesktopWorktreeCard({
			description: "Creating isolated worktree",
			stageLabel: "Cloning",
			progressLabel: "40%",
		});
		const installCard = buildDesktopInstallCard({
			description: "Installing agent runtime",
			stageLabel: "Downloading",
			progressLabel: "10%",
		});
		const errorCard = buildDesktopErrorCard({
			title: "Connection lost",
			description: "The agent disconnected mid-turn",
			details: "EPIPE",
		});

		expect([worktreeCard?.kind, installCard?.kind, errorCard?.kind]).toEqual([
			"worktree_setup",
			"install",
			"error",
		]);
		expect(worktreeCard).toMatchObject({
			id: "worktree-setup-card",
			description: "Creating isolated worktree",
		});
		expect(installCard).toMatchObject({
			id: "agent-install-card",
			description: "Installing agent runtime",
		});
		expect(errorCard).toMatchObject({
			id: "error-card",
			title: "Connection lost",
			description: "The agent disconnected mid-turn",
		});
	});
});
