import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { z } from "zod";
import { tauriClient } from "../../utils/tauri-client.js";
import type { FileReviewStatus } from "../components/review-panel/review-session-state.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({
	id: "session-review-state-store",
	name: "SessionReviewStateStore",
});

const resolvedHunkActionSchema = z.object({
	hunkIndex: z.number().int().min(0),
	action: z.enum(["accept", "reject"]),
});

const persistedFileReviewProgressSchema = z.object({
	filePath: z.string().min(1),
	status: z.enum(["accepted", "partial", "denied"]),
	acceptedHunks: z.number().int().min(0),
	rejectedHunks: z.number().int().min(0),
	pendingHunks: z.number().int().min(0),
	totalHunks: z.number().int().min(0),
	resolvedActions: z.array(resolvedHunkActionSchema),
});

const sessionReviewStateSchema = z.object({
	version: z.literal(1),
	filesByRevisionKey: z.record(z.string(), persistedFileReviewProgressSchema),
});

export type PersistedResolvedHunkAction = z.infer<typeof resolvedHunkActionSchema>;
export type PersistedFileReviewProgress = z.infer<typeof persistedFileReviewProgressSchema>;
export type SessionReviewState = z.infer<typeof sessionReviewStateSchema>;

function createEmptyReviewState(): SessionReviewState {
	return {
		version: 1,
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
		return errAsync(new Error(`Invalid review state: ${validation.error.message}`));
	});
}

export class SessionReviewStateStore {
	private statesBySession = new SvelteMap<string, SessionReviewState | null>();
	private loadedSessionIds = new SvelteSet<string>();
	private loadingSessionIds = new SvelteSet<string>();
	private saveTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

	getState(sessionId: string): SessionReviewState | null {
		return this.statesBySession.get(sessionId) ?? null;
	}

	isLoaded(sessionId: string): boolean {
		return this.loadedSessionIds.has(sessionId);
	}

	ensureLoaded(sessionId: string): void {
		if (this.loadedSessionIds.has(sessionId) || this.loadingSessionIds.has(sessionId)) return;

		this.loadingSessionIds.add(sessionId);
		tauriClient.sessionReviewState
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
			);
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
			...currentState,
			filesByRevisionKey: {
				...currentState.filesByRevisionKey,
				[revisionKey]: progress,
			},
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
			...currentState,
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
	status: FileReviewStatus;
	acceptedHunks: number;
	rejectedHunks: number;
	pendingHunks: number;
	totalHunks: number;
	resolvedActions: ReadonlyArray<PersistedResolvedHunkAction>;
}): PersistedFileReviewProgress {
	return {
		filePath: input.filePath,
		status: input.status,
		acceptedHunks: input.acceptedHunks,
		rejectedHunks: input.rejectedHunks,
		pendingHunks: input.pendingHunks,
		totalHunks: input.totalHunks,
		resolvedActions: [...input.resolvedActions],
	};
}
