import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { z } from "zod";
import { tauriClient } from "../../utils/tauri-client.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: "session-review-state-store",
	name: "SessionReviewStateStore",
});

const persistedFileReviewProgressSchema = z.object({
	filePath: z.string().min(1),
	reviewed: z.boolean(),
});

const sessionReviewStateSchema = z.object({
	version: z.literal(2),
	filesByRevisionKey: z.record(z.string(), persistedFileReviewProgressSchema),
});

export type PersistedFileReviewProgress = z.infer<typeof persistedFileReviewProgressSchema>;
export type SessionReviewState = z.infer<typeof sessionReviewStateSchema>;

function createEmptyReviewState(): SessionReviewState {
	return {
		version: 2,
		filesByRevisionKey: {},
	};
}

function statesEqual(a: SessionReviewState, b: SessionReviewState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function decodeState(raw: string | null): ResultAsync<SessionReviewState | null, Error> {
	if (raw === null) return okAsync(null);

	return ResultAsync.fromPromise(
		Promise.resolve(raw).then((value) => JSON.parse(value)),
		(error) =>
			error instanceof Error
				? error
				: new Error(`Failed to parse review state JSON: ${String(error)}`)
	).andThen((parsed) => {
		const validation = sessionReviewStateSchema.safeParse(parsed);
		if (validation.success) {
			return okAsync(validation.data);
		}
		// Older per-hunk schema versions are no longer supported; drop them so
		// the review modal starts from a clean per-file reviewed state.
		return errAsync(new Error(`Invalid review state: ${validation.error.message}`));
	});
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
		const loadPromise = tauriClient.sessionReviewState
			.get(sessionId)
			.andThen((raw) => decodeState(raw))
			.match(
				(state) => {
					this.statesBySession.set(sessionId, state);
					this.loadedSessionIds.add(sessionId);
					this.loadingSessionIds.delete(sessionId);
				},
				(error) => {
					logger.error("Failed to load session review state", { sessionId, error });
					this.statesBySession.set(sessionId, null);
					this.loadedSessionIds.add(sessionId);
					this.loadingSessionIds.delete(sessionId);
				}
			)
			.then(() => {
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

		tauriClient.sessionReviewState.delete(sessionId).mapErr((error) => {
			logger.error("Failed to delete session review state", { sessionId, error });
		});
	}

	private schedulePersist(sessionId: string): void {
		const existingTimer = this.saveTimers.get(sessionId);
		if (existingTimer) clearTimeout(existingTimer);

		const timer = setTimeout(() => {
			this.saveTimers.delete(sessionId);
			const state = this.getState(sessionId) ?? createEmptyReviewState();
			tauriClient.sessionReviewState.save(sessionId, JSON.stringify(state)).mapErr((error) => {
				logger.error("Failed to persist session review state", { sessionId, error });
			});
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
