import { describe, expect, it } from "vitest";
import {
	resolvePanelDraftOnMount,
	shouldDeferInitialComposerMountWork,
} from "./agent-input-mount-workflow.js";

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
			inlineImageEntries: [],
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

describe("shouldDeferInitialComposerMountWork", () => {
	it("defers restored conversation composer work when rows are already visible", () => {
		expect(
			shouldDeferInitialComposerMountWork({
				sessionId: "session-1",
				viewKind: "conversation",
				visibleEntryCount: 4,
			})
		).toBe(true);
	});

	it("does not defer new or empty panels", () => {
		expect(
			shouldDeferInitialComposerMountWork({
				sessionId: null,
				viewKind: "ready",
				visibleEntryCount: 0,
			})
		).toBe(false);
		expect(
			shouldDeferInitialComposerMountWork({
				sessionId: "session-1",
				viewKind: "conversation",
				visibleEntryCount: 0,
			})
		).toBe(false);
	});
});
