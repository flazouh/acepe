import type {
	SessionGraphRevision,
	SessionStateEnvelope,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import { confirmTranscriptViewportHeight } from "../../../session-state/session-state-viewport-command-service.js";

export type PendingHeightConfirmation = {
	readonly row: TranscriptViewportRow;
	readonly heightPx: number;
	readonly sessionId: string;
};

export type TranscriptViewportHeightConfirmDeps = {
	getSessionId: () => string | null;
	getRevision: () => SessionGraphRevision | null;
	getLastViewportHeightPx: () => number;
	getLocallyPinnedToTop: () => boolean;
	getLiveDetachedViewportOffsetPx: () => number | null;
	isDispatchSuppressed: () => boolean;
	nextViewportRequestGeneration: () => number;
	applyEnvelope: (envelope: SessionStateEnvelope | null) => void;
	handleDispatchError: (error: unknown) => void;
};

export class TranscriptViewportHeightConfirmCoordinator {
	readonly #deps: TranscriptViewportHeightConfirmDeps;
	#heightConfirmationRafPending = false;
	#heightConfirmationOwnerSessionId: string | null = null;
	readonly #pendingHeightConfirmations = new Map<string, PendingHeightConfirmation>();
	readonly #queuedHeightByRowVersion = new Map<string, number>();
	readonly #heightMeasurementKeyByRowId = new Map<string, string>();

	constructor(deps: TranscriptViewportHeightConfirmDeps) {
		this.#deps = deps;
	}

	dispatchHeightConfirmation(row: TranscriptViewportRow, heightPx: number): void {
		const sessionId = this.#deps.getSessionId();
		const revision = this.#deps.getRevision();
		if (sessionId === null || revision === null || this.#deps.isDispatchSuppressed()) {
			return;
		}
		const viewportOffsetPx = this.#deps.getLocallyPinnedToTop()
			? 0
			: this.#deps.getLiveDetachedViewportOffsetPx();
		confirmTranscriptViewportHeight({
			sessionId,
			revision,
			viewportHeightPx: this.#deps.getLastViewportHeightPx(),
			rowId: row.rowId,
			rowVersion: row.version,
			heightPx,
			viewportOffsetPx,
			requestGeneration: this.#deps.nextViewportRequestGeneration(),
		}).match(this.#deps.applyEnvelope, this.#deps.handleDispatchError);
	}

	scheduleHeightConfirmation(row: TranscriptViewportRow, heightPx: number): void {
		const sessionId = this.#deps.getSessionId();
		if (sessionId === null) {
			return;
		}
		if (this.#heightConfirmationOwnerSessionId !== sessionId) {
			this.#pendingHeightConfirmations.clear();
			this.#queuedHeightByRowVersion.clear();
			this.#heightMeasurementKeyByRowId.clear();
			this.#heightConfirmationOwnerSessionId = sessionId;
		}
		const measurementKey = `${row.rowId}:${row.version}`;
		if (this.#queuedHeightByRowVersion.get(measurementKey) === heightPx) {
			return;
		}
		const previousKey = this.#heightMeasurementKeyByRowId.get(row.rowId);
		if (previousKey !== undefined && previousKey !== measurementKey) {
			this.#queuedHeightByRowVersion.delete(previousKey);
		}
		this.#heightMeasurementKeyByRowId.set(row.rowId, measurementKey);
		this.#queuedHeightByRowVersion.set(measurementKey, heightPx);
		this.#pendingHeightConfirmations.set(row.rowId, { row, heightPx, sessionId });
		if (this.#heightConfirmationRafPending) {
			return;
		}
		this.#heightConfirmationRafPending = true;
		requestAnimationFrame(() => this.flushNextHeightConfirmation());
	}

	flushNextHeightConfirmation(): void {
		this.#heightConfirmationRafPending = false;
		const next = this.#pendingHeightConfirmations.entries().next();
		if (next.done) {
			return;
		}
		const [rowId, confirmation] = next.value;
		this.#pendingHeightConfirmations.delete(rowId);
		if (confirmation.sessionId === this.#deps.getSessionId()) {
			this.dispatchHeightConfirmation(confirmation.row, confirmation.heightPx);
		}
		if (this.#pendingHeightConfirmations.size > 0) {
			this.#heightConfirmationRafPending = true;
			requestAnimationFrame(() => this.flushNextHeightConfirmation());
		}
	}

	scheduleVisibleHeightConfirmations(input: {
		scrollContainer: HTMLDivElement;
		bufferRows: readonly TranscriptViewportRow[];
		isRowNearLiveViewport: (node: HTMLElement) => boolean;
	}): void {
		const rowById = new Map<string, TranscriptViewportRow>();
		for (const row of input.bufferRows) {
			rowById.set(row.rowId, row);
		}
		for (const node of input.scrollContainer.querySelectorAll<HTMLElement>("[data-entry-key]")) {
			if (!input.isRowNearLiveViewport(node)) {
				continue;
			}
			const rowId = node.getAttribute("data-entry-key");
			if (rowId === null) {
				continue;
			}
			const row = rowById.get(rowId);
			if (row === undefined) {
				continue;
			}
			const heightPx = Math.max(0, Math.round(node.getBoundingClientRect().height));
			if (heightPx > 0) {
				this.scheduleHeightConfirmation(row, heightPx);
			}
		}
	}

	createConfirmRowHeightAction(input: {
		isRowNearLiveViewport: (node: HTMLElement) => boolean;
	}): (node: HTMLDivElement, row: TranscriptViewportRow) => {
		update: (nextRow: TranscriptViewportRow) => void;
		destroy: () => void;
	} {
		return (node: HTMLDivElement, row: TranscriptViewportRow) => {
			let currentRow = row;
			let lastHeightPx = 0;
			const observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (entry === undefined) {
					return;
				}
				const heightPx = Math.max(0, Math.round(entry.contentRect.height));
				if (heightPx === lastHeightPx) {
					return;
				}
				lastHeightPx = heightPx;
				if (!input.isRowNearLiveViewport(node)) {
					return;
				}
				this.scheduleHeightConfirmation(currentRow, heightPx);
			});
			observer.observe(node);
			return {
				update(nextRow) {
					const measurementIdentityChanged =
						nextRow.rowId !== currentRow.rowId || nextRow.version !== currentRow.version;
					currentRow = nextRow;
					if (measurementIdentityChanged) {
						lastHeightPx = 0;
					}
				},
				destroy() {
					observer.disconnect();
				},
			};
		};
	}
}
