import { describe, expect, it } from "vitest";
import {
	resolvePanelDraftOnMount,
	shouldDeferInitialComposerMountWork,
	shouldWaitForInitialTranscriptRowsBeforeComposer,
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
				sessionCanSubmit: true,
			})
		).toBe(false);
	});

	it("defers while a selected session is still opening without submit capability", () => {
		expect(
			shouldDeferInitialComposerMountWork({
				sessionId: "session-1",
				viewKind: "ready",
				visibleEntryCount: 0,
				sessionCanSubmit: false,
			})
		).toBe(true);
	});
});

describe("shouldWaitForInitialTranscriptRowsBeforeComposer", () => {
	it("waits for rows before mounting the composer for a restored non-empty session", () => {
		expect(
			shouldWaitForInitialTranscriptRowsBeforeComposer({
				sessionId: "session-1",
				deferInitialComposerMountWork: true,
				visibleEntryCount: 4,
				renderedRowCount: 0,
			})
		).toBe(true);
		expect(
			shouldWaitForInitialTranscriptRowsBeforeComposer({
				sessionId: "session-1",
				deferInitialComposerMountWork: true,
				visibleEntryCount: 4,
				renderedRowCount: 1,
			})
		).toBe(false);
	});

	it("does not wait for new, empty, or non-deferred panels", () => {
		expect(
			shouldWaitForInitialTranscriptRowsBeforeComposer({
				sessionId: null,
				deferInitialComposerMountWork: true,
				visibleEntryCount: 4,
				renderedRowCount: 0,
			})
		).toBe(false);
		expect(
			shouldWaitForInitialTranscriptRowsBeforeComposer({
				sessionId: "session-1",
				deferInitialComposerMountWork: true,
				visibleEntryCount: 0,
				renderedRowCount: 0,
			})
		).toBe(false);
		expect(
			shouldWaitForInitialTranscriptRowsBeforeComposer({
				sessionId: "session-1",
				deferInitialComposerMountWork: false,
				visibleEntryCount: 4,
				renderedRowCount: 0,
			})
		).toBe(false);
	});
});
