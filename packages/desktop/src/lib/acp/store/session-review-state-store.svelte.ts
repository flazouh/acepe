import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { tauriClient } from "../../utils/tauri-client.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: "session-review-state-store",
	name: "SessionReviewStateStore",
});

const persistedFileReviewProgressSchema = Schema.Struct({
	filePath: Schema.NonEmptyString,
	reviewed: Schema.Boolean,
});

const sessionReviewStateSchema = Schema.Struct({
	version: Schema.Literal(2),
	filesByRevisionKey: Schema.Record(Schema.String, persistedFileReviewProgressSchema),
});

export type PersistedFileReviewProgress = typeof persistedFileReviewProgressSchema.Type;
export type SessionReviewState = typeof sessionReviewStateSchema.Type;

function createEmptyReviewState(): SessionReviewState {
	return {
		version: 2,
		filesByRevisionKey: {},
	};
}

function statesEqual(a: SessionReviewState, b: SessionReviewState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function decodeState(raw: string | null): Effect.Effect<SessionReviewState | null, Error> {
	if (raw === null) return Effect.succeed(null);

	const parseJson = fromThrowable(
		(value: string): unknown => JSON.parse(value),
		(error) =>
			error instanceof Error
				? error
				: new Error(`Failed to parse review state JSON: ${String(error)}`)
	);

	return parseJson(raw).pipe(
		Effect.flatMap((parsed) => {
			const validation = decodeUnknown(
				sessionReviewStateSchema,
				(error) => new Error(`Invalid review state: ${error.message}`)
			)(parsed);
			if (Result.isSuccess(validation)) {
				return Effect.succeed(validation.success);
			}
			// Older per-hunk schema versions are no longer supported; drop them so
			// the review modal starts from a clean per-file reviewed state.
			return Effect.fail(validation.failure);
		})
	);
}

export class SessionReviewStateStore {
	private statesBySession = new SvelteMap<string, SessionReviewState | null>();
	private loadedSessionIds = new SvelteSet<string>();
	private loadingSessionIds = new SvelteSet<string>();
	private loadPromisesBySession = new SvelteMap<string, Promise<void>>();
	private saveTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

	getState(sessionId: string): SessionReviewState | null {
		return this.statesBySession.get(sessionId) ?? null;
	}

	isLoaded(sessionId: string): boolean {
		return this.loadedSessionIds.has(sessionId);
	}

	ensureLoaded(sessionId: string): void {
		void this.ensureLoadedAsync(sessionId);
	}

	ensureLoadedAsync(sessionId: string): Promise<void> {
		if (this.loadedSessionIds.has(sessionId)) {
			return Promise.resolve();
		}

		const existingPromise = this.loadPromisesBySession.get(sessionId);
		if (existingPromise) {
			return existingPromise;
		}

		this.loadingSessionIds.add(sessionId);
		const loadPromise = Effect.runPromise(
			tauriClient.sessionReviewState.get(sessionId).pipe(
				Effect.flatMap((raw) => decodeState(raw)),
				Effect.match({
					onSuccess: (state) => {
						this.statesBySession.set(sessionId, state);
						this.loadedSessionIds.add(sessionId);
						this.loadingSessionIds.delete(sessionId);
					},
					onFailure: (error) => {
						logger.error("Failed to load session review state", { sessionId, error });
						this.statesBySession.set(sessionId, null);
						this.loadedSessionIds.add(sessionId);
						this.loadingSessionIds.delete(sessionId);
					},
				})
			)
		).then(() => {
			this.loadPromisesBySession.delete(sessionId);
		});

		this.loadPromisesBySession.set(sessionId, loadPromise);
		return loadPromise;
	}

	getFileProgress(sessionId: string, revisionKey: string): PersistedFileReviewProgress | null {
		const state = this.getState(sessionId);
		if (!state) return null;
		return state.filesByRevisionKey[revisionKey] ?? null;
	}

	upsertFileProgress(
		sessionId: string,
		revisionKey: string,
		progress: PersistedFileReviewProgress
	): void {
		const currentState = this.getState(sessionId) ?? createEmptyReviewState();
		const nextState: SessionReviewState = {
			version: 2,
			filesByRevisionKey: Object.assign({}, currentState.filesByRevisionKey, {
				[revisionKey]: progress,
			}),
		};

		if (statesEqual(currentState, nextState)) return;
		this.statesBySession.set(sessionId, nextState);
		this.schedulePersist(sessionId);
	}

	pruneToRevisionKeys(sessionId: string, validRevisionKeys: ReadonlySet<string>): void {
		const currentState = this.getState(sessionId);
		if (!currentState) return;

		const nextEntries = Object.entries(currentState.filesByRevisionKey).filter(([key]) =>
			validRevisionKeys.has(key)
		);
		const nextFilesByRevisionKey = Object.fromEntries(nextEntries);
		const nextState: SessionReviewState = {
			version: 2,
			filesByRevisionKey: nextFilesByRevisionKey,
		};

		if (statesEqual(currentState, nextState)) return;
		this.statesBySession.set(sessionId, nextState);
		this.schedulePersist(sessionId);
	}

	deleteState(sessionId: string): void {
		this.statesBySession.delete(sessionId);
		this.loadedSessionIds.delete(sessionId);
		this.loadingSessionIds.delete(sessionId);
		this.loadPromisesBySession.delete(sessionId);

		const timer = this.saveTimers.get(sessionId);
		if (timer) {
			clearTimeout(timer);
			this.saveTimers.delete(sessionId);
		}

		void Effect.runPromise(
			tauriClient.sessionReviewState.delete(sessionId).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (error) => {
						logger.error("Failed to delete session review state", { sessionId, error });
					},
				})
			)
		);
	}

	private schedulePersist(sessionId: string): void {
		const existingTimer = this.saveTimers.get(sessionId);
		if (existingTimer) clearTimeout(existingTimer);

		const timer = setTimeout(() => {
			this.saveTimers.delete(sessionId);
			const state = this.getState(sessionId) ?? createEmptyReviewState();
			void Effect.runPromise(
				tauriClient.sessionReviewState.save(sessionId, JSON.stringify(state)).pipe(
					Effect.match({
						onSuccess: () => undefined,
						onFailure: (error) => {
							logger.error("Failed to persist session review state", { sessionId, error });
						},
					})
				)
			);
		}, 250);

		this.saveTimers.set(sessionId, timer);
	}
}

export const sessionReviewStateStore = new SessionReviewStateStore();

export function toPersistedFileReviewProgress(input: {
	filePath: string;
	reviewed: boolean;
}): PersistedFileReviewProgress {
	return {
		filePath: input.filePath,
		reviewed: input.reviewed,
	};
}
