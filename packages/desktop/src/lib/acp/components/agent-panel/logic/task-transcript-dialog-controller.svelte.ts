import { SvelteMap } from "svelte/reactivity";
import type {
	SessionGraphRevision,
	TranscriptScope,
	TranscriptRowPageResult,
	TranscriptViewportRow,
} from "../../../../services/acp-types.js";
import { readTranscriptRowPage } from "../../../session-state/session-state-viewport-command-service.js";

const TASK_TRANSCRIPT_ROW_PAGE_SIZE = 256;
const MAX_STALE_PAGE_RETRIES = 2;

export type TaskTranscriptDialogIdentity = {
	readonly sessionId: string;
	readonly panelId: string;
	readonly rootRowId: string;
	readonly operationId: string;
	readonly key: string;
};

export type TaskTranscriptScope = Extract<TranscriptScope, { readonly kind: "operation" }>;

export type TaskTranscriptPageInput = {
	readonly sessionId: string;
	readonly scope: TaskTranscriptScope;
	readonly startRowIndex: number;
	readonly limit: number;
	readonly expectedRevision: SessionGraphRevision;
};

export type TaskTranscriptDialogState = {
	readonly identity: TaskTranscriptDialogIdentity;
	readonly scope: TaskTranscriptScope | null;
	readonly revision: SessionGraphRevision | null;
	readonly open: boolean;
	readonly status: "idle" | "loading" | "ready" | "error";
	readonly rows: readonly TranscriptViewportRow[];
	readonly totalRowCount: number;
	readonly hasMore: boolean;
	readonly errorMessage: string | null;
};

export type TaskTranscriptDialogControllerDeps = {
	readonly readPage: (
		input: TaskTranscriptPageInput
	) => ReturnType<typeof readTranscriptRowPage>;
};

export function taskTranscriptDialogIdentity(input: {
	readonly sessionId: string;
	readonly panelId: string;
	readonly rootRowId: string;
	readonly operationId: string;
}): TaskTranscriptDialogIdentity {
	return {
		sessionId: input.sessionId,
		panelId: input.panelId,
		rootRowId: input.rootRowId,
		operationId: input.operationId,
		key: JSON.stringify([
			input.sessionId,
			input.panelId,
			input.rootRowId,
			input.operationId,
		]),
	};
}

function emptyTaskTranscriptDialogState(
	identity: TaskTranscriptDialogIdentity
): TaskTranscriptDialogState {
	return {
		identity,
		scope: null,
		revision: null,
		open: false,
		status: "idle",
		rows: [],
		totalRowCount: 0,
		hasMore: false,
		errorMessage: null,
	};
}

function withOpen(state: TaskTranscriptDialogState, open: boolean): TaskTranscriptDialogState {
	return {
		identity: state.identity,
		scope: state.scope,
		revision: state.revision,
		open,
		status: state.status,
		rows: state.rows,
		totalRowCount: state.totalRowCount,
		hasMore: state.hasMore,
		errorMessage: state.errorMessage,
	};
}

function revisionsEqual(left: SessionGraphRevision, right: SessionGraphRevision): boolean {
	return (
		left.graphRevision === right.graphRevision &&
		left.transcriptRevision === right.transcriptRevision &&
		left.lastEventSeq === right.lastEventSeq
	);
}

function revisionFromStalePageResult(result: Extract<TranscriptRowPageResult, { status: "stale" }>): SessionGraphRevision {
	return {
		graphRevision: result.graphRevision,
		transcriptRevision: result.transcriptRevision,
		lastEventSeq: result.lastEventSeq,
	};
}

export class TaskTranscriptDialogController {
	readonly #states = new SvelteMap<string, TaskTranscriptDialogState>();
	readonly #requestGenerationByKey = new Map<string, number>();

	constructor(private readonly deps: TaskTranscriptDialogControllerDeps) {}

	getState(identity: TaskTranscriptDialogIdentity): TaskTranscriptDialogState {
		return this.#states.get(identity.key) ?? emptyTaskTranscriptDialogState(identity);
	}

	close(identity: TaskTranscriptDialogIdentity): void {
		this.#states.set(identity.key, withOpen(this.getState(identity), false));
	}

	setOpen(input: {
		readonly identity: TaskTranscriptDialogIdentity;
		readonly scope: TaskTranscriptScope;
		readonly revision: SessionGraphRevision;
		readonly open: boolean;
	}): void {
		const existing = this.getState(input.identity);
		if (!input.open) {
			this.#states.set(input.identity.key, withOpen(existing, false));
			return;
		}

		if (existing.status === "ready" || existing.status === "loading") {
			this.#states.set(input.identity.key, withOpen(existing, true));
			return;
		}

		const loadingState: TaskTranscriptDialogState = {
			identity: input.identity,
			scope: input.scope,
			revision: input.revision,
			open: true,
			status: "loading",
			rows: [],
			totalRowCount: 0,
			hasMore: false,
			errorMessage: null,
		};
		this.#states.set(input.identity.key, loadingState);
		this.loadPage(loadingState, 0);
	}

	syncOpenRevision(input: {
		readonly identity: TaskTranscriptDialogIdentity;
		readonly scope: TaskTranscriptScope;
		readonly revision: SessionGraphRevision;
	}): void {
		const existing = this.getState(input.identity);
		if (!existing.open || existing.scope === null || existing.revision === null) {
			return;
		}
		if (existing.status === "loading") {
			return;
		}
		if (revisionsEqual(existing.revision, input.revision)) {
			return;
		}

		const loadingState: TaskTranscriptDialogState = {
			identity: input.identity,
			scope: input.scope,
			revision: input.revision,
			open: true,
			status: "loading",
			rows: existing.rows,
			totalRowCount: existing.totalRowCount,
			hasMore: existing.hasMore,
			errorMessage: null,
		};
		this.#states.set(input.identity.key, loadingState);
		this.loadPage(loadingState, 0);
	}

	loadNextPage(identity: TaskTranscriptDialogIdentity): void {
		const state = this.getState(identity);
		if (
			state.status !== "ready" ||
			!state.hasMore ||
			state.scope === null ||
			state.revision === null
		) {
			return;
		}
		this.loadPage(state, state.rows.length);
	}

	private loadPage(
		state: TaskTranscriptDialogState,
		startRowIndex: number,
		staleRetryCount = 0
	): void {
		if (state.scope === null || state.revision === null) {
			return;
		}
		const generation = (this.#requestGenerationByKey.get(state.identity.key) ?? 0) + 1;
		this.#requestGenerationByKey.set(state.identity.key, generation);

		void this.deps
			.readPage({
				sessionId: state.identity.sessionId,
				scope: state.scope,
				startRowIndex,
				limit: TASK_TRANSCRIPT_ROW_PAGE_SIZE,
				expectedRevision: state.revision,
			})
			.match(
				(result) => {
					if (this.#requestGenerationByKey.get(state.identity.key) !== generation) {
						return;
					}
					const current = this.getState(state.identity);
					if (result.status !== "current") {
						if (result.status === "stale" && staleRetryCount < MAX_STALE_PAGE_RETRIES) {
							const refreshedState: TaskTranscriptDialogState = {
								identity: current.identity,
								scope: current.scope,
								revision: revisionFromStalePageResult(result),
								open: current.open,
								status: "loading",
								rows: [],
								totalRowCount: 0,
								hasMore: false,
								errorMessage: null,
							};
							this.#states.set(state.identity.key, refreshedState);
							this.loadPage(refreshedState, 0, staleRetryCount + 1);
							return;
						}
						this.#states.set(state.identity.key, {
							identity: current.identity,
							scope: current.scope,
							revision: current.revision,
							open: current.open,
							status: "error",
							rows: current.rows,
							totalRowCount: current.totalRowCount,
							hasMore: false,
							errorMessage:
								result.status === "stale"
									? "The Task transcript changed. Close and reopen it."
									: "The Task transcript is not available yet.",
						});
						return;
					}

					const rows =
						startRowIndex === 0 ? result.rows : current.rows.concat(result.rows);
					this.#states.set(state.identity.key, {
						identity: current.identity,
						scope: current.scope,
						revision: {
							graphRevision: result.graphRevision,
							transcriptRevision: result.transcriptRevision,
							lastEventSeq: result.lastEventSeq,
						},
						open: current.open,
						status: "ready",
						rows,
						totalRowCount: result.totalRowCount,
						hasMore: rows.length < result.totalRowCount,
						errorMessage: null,
					});
				},
				() => {
					if (this.#requestGenerationByKey.get(state.identity.key) !== generation) {
						return;
					}
					const current = this.getState(state.identity);
					this.#states.set(state.identity.key, {
						identity: current.identity,
						scope: current.scope,
						revision: current.revision,
						open: current.open,
						status: "error",
						rows: current.rows,
						totalRowCount: current.totalRowCount,
						hasMore: current.hasMore,
						errorMessage: "The Task transcript could not be loaded.",
					});
				}
			);
	}
}

export function createTaskTranscriptDialogController(): TaskTranscriptDialogController {
	return new TaskTranscriptDialogController({ readPage: readTranscriptRowPage });
}
