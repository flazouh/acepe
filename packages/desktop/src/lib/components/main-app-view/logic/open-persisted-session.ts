import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { api } from "$lib/acp/store/api.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelIds = new Set<string>();

type SessionOpenStore = Pick<
	SessionStore,
	| "setSessionLoading"
	| "setSessionLoaded"
	| "setLocalCreatedSessionLoaded"
	| "getSessionCold"
	| "connectSession"
>;

type SessionOpenHydratorLike = Pick<
	SessionOpenHydrator,
	"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
>;

interface OpenPersistedSessionOptions {
	readonly panelId: string;
	readonly sessionId: string;
	readonly sessionStore: SessionOpenStore;
	readonly sessionOpenHydrator: SessionOpenHydratorLike;
	readonly getSessionOpenResult?: typeof api.getSessionOpenResult;
	readonly timeoutMs: number;
	readonly source: "initialization-manager" | "session-handler";
}

function isProviderHistoryBackedSession(session: ReturnType<SessionOpenStore["getSessionCold"]>): boolean {
	return session?.sessionLifecycleState !== "created" || Boolean(session.sourcePath);
}

function reattachLocalCreatedSession(input: {
	readonly source: OpenPersistedSessionOptions["source"];
	readonly panelId: string;
	readonly sessionId: string;
	readonly sessionStore: SessionOpenStore;
	readonly agentId: string;
}): ResultAsync<void, AppError> {
	const { source, panelId, sessionId, sessionStore, agentId } = input;
	return sessionStore
		.connectSession(sessionId)
		.map(() => {
			sessionStore.setLocalCreatedSessionLoaded(sessionId);
			logger.debug("Reattached local created session", {
				source,
				panelId,
				sessionId,
				agentId,
			});
			return undefined;
		})
		.orElse((error: AppError) => {
			sessionStore.setSessionLoaded(sessionId);
			logger.warn("Failed to reattach local created session", {
				source,
				panelId,
				sessionId,
				agentId,
				error,
			});
			return okAsync(undefined);
		});
}

export function openPersistedSession(options: OpenPersistedSessionOptions): void {
	const {
		panelId,
		sessionId,
		sessionStore,
		sessionOpenHydrator,
		timeoutMs,
		source,
		getSessionOpenResult = api.getSessionOpenResult,
	} = options;
	if (inflightPanelIds.has(panelId)) {
		logger.debug("Skipping duplicate session-open request", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const session = sessionStore.getSessionCold(sessionId);
	if (!session) {
		logger.warn("Cannot open session because metadata is missing", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const shouldAttemptLocalReattach = !isProviderHistoryBackedSession(session);

	inflightPanelIds.add(panelId);
	sessionStore.setSessionLoading(sessionId);
	const requestToken = sessionOpenHydrator.beginAttempt(panelId);

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error("Session open timed out")), timeoutMs);
	});

	const openPromise = getSessionOpenResult(
		sessionId,
		session.projectPath,
		session.agentId,
		session.sourcePath
	)
		.andThen((result) => {
			if (result.outcome === "missing") {
				// GOD: Rust emitted a Failed lifecycle envelope (SessionGoneUpstream)
				// from get_session_open_result before returning. UI is canonical-driven.
				sessionOpenHydrator.clearAttempt(panelId);
				logger.warn("Session open returned missing", {
					source,
					panelId,
					sessionId,
				});
				if (shouldAttemptLocalReattach) {
					return reattachLocalCreatedSession({
						source,
						panelId,
						sessionId,
						sessionStore,
						agentId: session.agentId,
					});
				}
				sessionStore.setSessionLoaded(sessionId);
				return okAsync(undefined);
			}

			if (result.outcome === "error") {
				// GOD: Rust emitted a Failed lifecycle envelope (ResumeFailed for
				// transient, SessionGoneUpstream for upstream-permanent) before
				// returning. UI reads lifecycle.failureReason via the canonical
				// projection.
				sessionOpenHydrator.clearAttempt(panelId);
				logger.warn("Session open returned explicit error state", {
					source,
					panelId,
					sessionId,
					message: result.message,
					reason: result.reason,
					retryable: result.retryable,
				});
				if (shouldAttemptLocalReattach) {
					return reattachLocalCreatedSession({
						source,
						panelId,
						sessionId,
						sessionStore,
						agentId: session.agentId,
					});
				}
				sessionStore.setSessionLoaded(sessionId);
				return okAsync(undefined);
			}

			return sessionOpenHydrator
				.hydrateFound(panelId, requestToken, result)
				.andThen((hydration) => {
					if (!sessionOpenHydrator.isCurrentAttempt(panelId, requestToken)) {
						return okAsync(undefined);
					}

					sessionStore.setSessionLoaded(hydration.canonicalSessionId);
					sessionOpenHydrator.clearAttempt(panelId);
					return sessionStore
						.connectSession(hydration.canonicalSessionId, {
							openToken: hydration.openToken,
						})
						.orElse((error) => {
							logger.error("Failed to reconnect hydrated session", {
								source,
								panelId,
								requestedSessionId: sessionId,
								canonicalSessionId: hydration.canonicalSessionId,
								error,
							});
							return okAsync(undefined);
						})
						.map(() => undefined);
				});
		})
		.match(
			() => undefined,
			(error: AppError) => {
				if (shouldAttemptLocalReattach) {
					logger.warn("Session open request failed before local-created reattach", {
						source,
						panelId,
						sessionId,
						agentId: session.agentId,
						error,
					});
					return reattachLocalCreatedSession({
						source,
						panelId,
						sessionId,
						sessionStore,
						agentId: session.agentId,
					}).match(
						() => undefined,
						() => undefined
					);
				}
				sessionStore.setSessionLoaded(sessionId);
				logger.error("Failed to open session", {
					source,
					panelId,
					sessionId,
					error,
				});
			}
		);

	Promise.race([openPromise, timeoutPromise])
		.catch(() => {
			sessionOpenHydrator.clearAttempt(panelId);
			sessionStore.setSessionLoaded(sessionId);
			logger.error("Session open timed out", {
				source,
				panelId,
				sessionId,
				timeoutMs,
			});
		})
		.finally(() => {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			inflightPanelIds.delete(panelId);
		});
}

export function __resetOpenPersistedSessionForTests(): void {
	inflightPanelIds.clear();
}
