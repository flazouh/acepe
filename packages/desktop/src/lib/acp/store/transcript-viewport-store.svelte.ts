import { SvelteMap } from "svelte/reactivity";
import type { SessionGraphRevision, VisibleTranscriptWindowPayload } from "../../services/acp-types.js";

export type ViewportAttachmentStatus = "attached" | "reattaching" | "reattachFailed";

export type TranscriptViewportProjection = {
	readonly sessionId: string;
	readonly revision: SessionGraphRevision;
	readonly viewportRevision: number;
	readonly totalHeightPx: number;
	readonly viewportOffsetPx: number;
	readonly visibleStartIndex: number;
	readonly visibleEndIndex: number;
	readonly rows: VisibleTranscriptWindowPayload["rows"];
	readonly rowOffsetsPx: VisibleTranscriptWindowPayload["rowOffsetsPx"];
	readonly mode: VisibleTranscriptWindowPayload["mode"];
	readonly diagnostics: VisibleTranscriptWindowPayload["diagnostics"];
};

function isNewerVisibleWindow(
	current: TranscriptViewportProjection | null,
	incoming: VisibleTranscriptWindowPayload
): boolean {
	if (current === null) {
		return true;
	}
	if (incoming.graphRevision.graphRevision > current.revision.graphRevision) {
		return true;
	}
	if (incoming.graphRevision.graphRevision < current.revision.graphRevision) {
		return false;
	}
	return incoming.viewportRevision > current.viewportRevision;
}

function projectionFromWindow(window: VisibleTranscriptWindowPayload): TranscriptViewportProjection {
	return {
		sessionId: window.sessionId,
		revision: window.graphRevision,
		viewportRevision: window.viewportRevision,
		totalHeightPx: window.totalHeightPx,
		viewportOffsetPx: window.viewportOffsetPx,
		visibleStartIndex: window.visibleStartIndex,
		visibleEndIndex: window.visibleEndIndex,
		rows: window.rows,
		rowOffsetsPx: window.rowOffsetsPx,
		mode: window.mode,
		diagnostics: window.diagnostics,
	};
}

export class TranscriptViewportStore {
	private readonly projections = new SvelteMap<string, TranscriptViewportProjection>();
	private readonly attachmentStatus = new SvelteMap<string, ViewportAttachmentStatus>();

	applyVisibleWindow(window: VisibleTranscriptWindowPayload): boolean {
		const current = this.projections.get(window.sessionId) ?? null;
		if (!isNewerVisibleWindow(current, window)) {
			return false;
		}
		this.projections.set(window.sessionId, projectionFromWindow(window));
		this.markAttached(window.sessionId);
		return true;
	}

	getProjection(sessionId: string | null): TranscriptViewportProjection | null {
		if (sessionId === null) {
			return null;
		}
		return this.projections.get(sessionId) ?? null;
	}

	getAttachmentStatus(sessionId: string | null): ViewportAttachmentStatus {
		if (sessionId === null) {
			return "attached";
		}
		return this.attachmentStatus.get(sessionId) ?? "attached";
	}

	markReattaching(sessionId: string): void {
		this.attachmentStatus.set(sessionId, "reattaching");
		this.projections.delete(sessionId);
	}

	markReattachFailed(sessionId: string): void {
		// Only the in-flight "reattaching" episode may transition to failed. This
		// guards two cases: removeSession having already cleared the entry (so a
		// late connect-failure callback can't resurrect a dead session), and an
		// accepted window having already flipped the status back to "attached"
		// (so a late watchdog can't clobber a successful re-attach).
		if (this.attachmentStatus.get(sessionId) === "reattaching") {
			this.attachmentStatus.set(sessionId, "reattachFailed");
		}
	}

	private markAttached(sessionId: string): void {
		const status = this.attachmentStatus.get(sessionId);
		if (status !== undefined && status !== "attached") {
			this.attachmentStatus.set(sessionId, "attached");
		}
	}

	removeSession(sessionId: string): void {
		this.projections.delete(sessionId);
		this.attachmentStatus.delete(sessionId);
	}
}
