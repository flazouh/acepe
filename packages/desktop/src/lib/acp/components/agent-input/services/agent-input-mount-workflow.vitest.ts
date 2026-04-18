import { describe, expect, it } from "vitest";
import { resolvePanelDraftOnMount } from "./agent-input-mount-workflow.js";

describe("resolvePanelDraftOnMount", () => {
	it("returns none when there is no panel id", () => {
		expect(
			resolvePanelDraftOnMount({
				panelId: undefined,
				sessionId: null,
				pendingComposerRestore: null,
				storedDraft: "x",
				hasPendingUserEntry: false,
			})
		).toEqual({ kind: "none" });
	});

	it("prefers pending composer restore snapshot over stored draft", () => {
		const snapshot = {
			draft: "hello",
			attachments: [],
			inlineTextEntries: [],
		};
		expect(
			resolvePanelDraftOnMount({
				panelId: "p1",
				sessionId: null,
				pendingComposerRestore: snapshot,
				storedDraft: "ignored",
				hasPendingUserEntry: false,
			})
		).toEqual({ kind: "pending_snapshot", snapshot });
	});

	it("restores initial draft for empty-state panel with stored draft", () => {
		expect(
			resolvePanelDraftOnMount({
				panelId: "p1",
				sessionId: null,
				pendingComposerRestore: null,
				storedDraft: "draft text",
				hasPendingUserEntry: false,
			})
		).toEqual({ kind: "initial_draft", draft: "draft text" });
	});

	it("skips initial draft when a pending user entry exists", () => {
		expect(
			resolvePanelDraftOnMount({
				panelId: "p1",
				sessionId: null,
				pendingComposerRestore: null,
				storedDraft: "draft text",
				hasPendingUserEntry: true,
			})
		).toEqual({ kind: "none" });
	});
});
