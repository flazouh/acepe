/**
 * SessionLoadingFacade — session load/scan/preload surface (ADR-0002).
 */
import { okAsync, type ResultAsync } from "neverthrow";
import type { HistoryEntry } from "../../services/claude-history-types.js";
import type { AppError } from "../errors/app-error.js";
import type { SessionConnectionService } from "./session-connection-service.svelte.js";
import type { SessionListState } from "./session-list-state.svelte.js";
import type { SessionRepository } from "./services/session-repository.js";
import type { PrLinkStateStore } from "./pr-link-state-store.svelte.js";
import type { SessionCold } from "./types.js";
import type { SessionReadFacade } from "./session-read-facade.js";
import type { SessionWriteFacade } from "./session-write-facade.js";

export type SessionLoadingFacadeDeps = {
	readonly repository: SessionRepository;
	readonly listState: SessionListState;
	readonly connectionService: SessionConnectionService;
	readonly prLinkState: PrLinkStateStore;
	readonly read: SessionReadFacade;
	readonly write: SessionWriteFacade;
	readonly setLoading: (loading: boolean) => void;
};

export class SessionLoadingFacade {
	readonly #deps: SessionLoadingFacadeDeps;

	constructor(deps: SessionLoadingFacadeDeps) {
		this.#deps = deps;
	}

	setLoading(loading: boolean): void {
		this.#deps.setLoading(loading);
	}

	setSessionLoading(sessionId: string): void {
		this.#deps.connectionService.sendContentLoad(sessionId);
	}

	setSessionLoaded(sessionId: string): void {
		this.#deps.connectionService.sendContentLoaded(sessionId);
	}

	setLocalCreatedSessionLoaded(sessionId: string): void {
		this.#deps.connectionService.sendContentLoad(sessionId);
		this.#deps.connectionService.sendContentLoaded(sessionId);
		this.setSessionLoaded(sessionId);
	}

	loadSessions(projectPaths?: string[]): ResultAsync<SessionCold[], AppError> {
		return this.#deps.repository.loadSessions(this.#deps.listState.sessions, projectPaths).map((sessions) => {
			this.#deps.prLinkState.refreshAllPrStates();
			return sessions;
		});
	}

	scanSessions(projectPaths: string[]): ResultAsync<void, AppError> {
		return this.#deps.repository.scanSessions(this.#deps.listState.sessions, projectPaths).map(() => {
			this.#deps.prLinkState.refreshAllPrStates();
		});
	}

	refreshSessionsFromScan(entries: HistoryEntry[]): void {
		this.#deps.repository.refreshSessionsFromScan(this.#deps.listState.sessions, entries);
	}

	loadStartupSessions(
		sessionIds: string[]
	): ResultAsync<{ missing: string[]; aliasRemaps: Record<string, string> }, AppError> {
		return this.#deps.repository.loadStartupSessions(this.#deps.listState.sessions, sessionIds);
	}

	preloadSessions(
		sessionIds: string[]
	): ResultAsync<{ loaded: SessionCold[]; missing: string[] }, AppError> {
		return this.#deps.repository.preloadSessions(sessionIds);
	}

	registerSessionPlaceholder(
		sessionId: string,
		projectPath: string,
		agentId: string,
		options?: {
			sourcePath?: string;
			worktreePath?: string;
			placeholderTitle?: string | null;
		}
	): void {
		if (this.#deps.read.getSessionIdentity(sessionId)) {
			return;
		}
		const now = new Date();
		this.#deps.write.addSession({
			id: sessionId,
			projectPath,
			agentId,
			worktreePath: options?.worktreePath,
			title: options?.placeholderTitle ?? null,
			updatedAt: now,
			createdAt: now,
			sourcePath: options?.sourcePath,
			sessionLifecycleState: options?.sourcePath ? "persisted" : "created",
			parentId: null,
		});
	}

	loadHistoricalSession(
		id: string,
		projectPath: string,
		title: string,
		agentId: string,
		sourcePath?: string,
		sequenceId?: number,
		worktreePath?: string
	): ResultAsync<SessionCold, AppError> {
		return this.#deps.repository.loadHistoricalSession(
			id,
			projectPath,
			title,
			agentId,
			sourcePath,
			sequenceId,
			undefined,
			worktreePath
		);
	}
}
