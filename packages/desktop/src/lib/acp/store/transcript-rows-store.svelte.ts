/**
 * Reactive `$state` spine over the pure {@link ./transcript-rows-store.js}
 * reducers. The decision logic and the wire-boundary pixel-drop live in the pure
 * module (unit-tested under `bun test`); this class is a thin reactive shell the
 * viewport component (Unit 4) renders from. No `$effect`.
 */

import type {
	SessionOpenTranscriptRowPage,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import {
	applyRowsDelta,
	applyRowsPage,
	applyRowsPush,
	EMPTY_TRANSCRIPT_ROWS_STATE,
	type RowsApplyStatus,
	rowsDeltaFromBuffer,
	rowsPageFromInitialPage,
	rowsPushFromBuffer,
	type TranscriptRowsState,
} from "./transcript-rows-store.js";

export class TranscriptRowsStore {
	#state = $state<TranscriptRowsState>(EMPTY_TRANSCRIPT_ROWS_STATE);

	get state(): TranscriptRowsState {
		return this.#state;
	}

	/** Canonical, ordered rows for rendering (key each by `renderKey`). */
	get rows() {
		return this.#state.rows;
	}

	applyPush(push: ViewportBufferPush): RowsApplyStatus {
		const result = applyRowsPush(this.#state, rowsPushFromBuffer(push));
		this.#state = result.state;
		return result.status;
	}

	applyDelta(delta: ViewportBufferDelta): RowsApplyStatus {
		const result = applyRowsDelta(this.#state, rowsDeltaFromBuffer(delta));
		this.#state = result.state;
		return result.status;
	}

	applyPage(sessionId: string, page: SessionOpenTranscriptRowPage): RowsApplyStatus {
		const result = applyRowsPage(this.#state, rowsPageFromInitialPage(sessionId, page));
		this.#state = result.state;
		return result.status;
	}

	reset(): void {
		this.#state = EMPTY_TRANSCRIPT_ROWS_STATE;
	}
}
