/**
 * Decides how to hydrate the composer from PanelStore on mount (restore snapshot vs draft vs skip).
 */

import { shouldRestoreInitialDraft } from "$lib/components/main-app-view/components/content/logic/empty-state-send-state.js";
import type { ComposerRestoreSnapshot } from "../logic/first-send-recovery.js";

export type PanelDraftMountResolution =
	| { kind: "pending_snapshot"; snapshot: ComposerRestoreSnapshot }
	| { kind: "initial_draft"; draft: string }
	| { kind: "none" };

export function resolvePanelDraftOnMount(args: {
	panelId: string | undefined;
	sessionId: string | null | undefined;
	pendingComposerRestore: ComposerRestoreSnapshot | null;
	storedDraft: string;
	hasPendingUserEntry: boolean;
}): PanelDraftMountResolution {
	if (!args.panelId) {
		return { kind: "none" };
	}
	if (args.pendingComposerRestore !== null) {
		return { kind: "pending_snapshot", snapshot: args.pendingComposerRestore };
	}
	if (
		shouldRestoreInitialDraft({
			panelId: args.panelId,
			sessionId: args.sessionId,
			draft: args.storedDraft,
			hasPendingUserEntry: args.hasPendingUserEntry,
		})
	) {
		return { kind: "initial_draft", draft: args.storedDraft };
	}
	return { kind: "none" };
}

export function shouldDeferInitialComposerMountWork(args: {
	readonly sessionId: string | null | undefined;
	readonly viewKind: string;
	readonly visibleEntryCount: number | null | undefined;
	readonly sessionCanSubmit?: boolean | null | undefined;
}): boolean {
	if (args.sessionId === null || args.sessionId === undefined) {
		return false;
	}
	if (args.viewKind === "ready" && args.sessionCanSubmit === false) {
		return true;
	}
	return args.viewKind === "conversation" && (args.visibleEntryCount ?? 0) > 0;
}

export function shouldWaitForInitialTranscriptRowsBeforeComposer(args: {
	readonly sessionId: string | null | undefined;
	readonly deferInitialComposerMountWork: boolean;
	readonly visibleEntryCount: number | null | undefined;
	readonly renderedRowCount: number | null | undefined;
}): boolean {
	if (!args.deferInitialComposerMountWork) {
		return false;
	}
	if (args.sessionId === null || args.sessionId === undefined) {
		return false;
	}
	if ((args.visibleEntryCount ?? 0) <= 0) {
		return false;
	}
	return (args.renderedRowCount ?? 0) <= 0;
}
