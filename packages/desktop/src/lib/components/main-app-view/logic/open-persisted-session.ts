import { okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { api } from "$lib/acp/store/api.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelIds = new Set<string>();
const HYDRATED_RECONNECT_REFRESH_TIMEOUT_MS = 45_000;
const HYDRATED_RECONNECT_REFRESH_INTERVAL_MS = 1_000;

type SessionOpenStore = Pick<
	SessionStore,
	| "setSessionLoading"
	| "setSessionLoaded"
	| "setLocalCreatedSessionLoaded"
	| "getSessionIdentity"
	| "getSessionMetadata"
	| "getSessionLifecycleStatus"
	| "connectSession"
	| "refreshCanonicalSessionState"
	| "clearSessionEntries"
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

interface HydratedReconnectOptions {
	readonly source: OpenPersistedSessionOptions["source"];
	readonly panelId: string;
	readonly requestedSessionId: string;
	readonly canonicalSessionId: string;
	readonly openToken: string;
	readonly sessionStore: SessionOpenStore;
}

function isProviderHistoryBackedSession(
	sessionMetadata: NonNullable<ReturnType<SessionOpenStore["getSessionMetadata"]>>
): boolean {
	return sessionMetadata.sessionLifecycleState !== "created" || Boolean(sessionMetadata.sourcePath);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function refreshHydratedSessionUntilReady(input: HydratedReconnectOptions): Promise<void> {
	const { source, panelId, requestedSessionId, canonicalSessionId, sessionStore } = input;
	const deadlineMs = Date.now() + HYDRATED_RECONNECT_REFRESH_TIMEOUT_MS;

	while (Date.now() <= deadlineMs) {
		await delay(HYDRATED_RECONNECT_REFRESH_INTERVAL_MS);
		await sessionStore
			.refreshCanonicalSessionState(canonicalSessionId)
			.orElse((error) => {
				logger.warn("Failed to refresh hydrated session snapshot after reconnect start", {
					source,
					panelId,
					requestedSessionId,
					canonicalSessionId,
					error,
				});
				return okAsync(undefined);
			})
			.match(
				() => undefined,
				() => undefined
			);

		if (sessionStore.getSessionLifecycleStatus(canonicalSessionId) === "ready") {
			return;
		}
	}
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

function reconnectHydratedSession(input: HydratedReconnectOptions): Promise<void> {
	const { source, panelId, requestedSessionId, canonicalSessionId, openToken, sessionStore } = input;
	const reconnect = sessionStore
		.connectSession(canonicalSessionId, {
			openToken,
		})
		.orElse((error) => {
			logger.error("Failed to reconnect hydrated session", {
				source,
				panelId,
				requestedSessionId,
				canonicalSessionId,
				error,
			});
			return okAsync(undefined);
		})
		.match(
			() => undefined,
			() => undefined
		);
	const refresh = refreshHydratedSessionUntilReady(input);

	return Promise.all([refresh, reconnect]).then(() => undefined);
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

	const sessionIdentity = sessionStore.getSessionIdentity(sessionId);
	const sessionMetadata = sessionStore.getSessionMetadata(sessionId);
	if (!sessionIdentity || !sessionMetadata) {
		logger.warn("Cannot open session because metadata is missing", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const shouldAttemptLocalReattach = !isProviderHistoryBackedSession(sessionMetadata);

	inflightPanelIds.add(panelId);
	if (isProviderHistoryBackedSession(sessionMetadata)) {
		sessionStore.clearSessionEntries(sessionId);
	}
	sessionStore.setSessionLoading(sessionId);
	const requestToken = sessionOpenHydrator.beginAttempt(panelId);
	let reconnectPromise: Promise<void> | null = null;

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error("Session open timed out")), timeoutMs);
	});

	const openPromise = getSessionOpenResult(
		sessionId,
		sessionIdentity.projectPath,
		sessionIdentity.agentId,
		sessionMetadata.sourcePath
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
						agentId: sessionIdentity.agentId,
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
						agentId: sessionIdentity.agentId,
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
					reconnectPromise = reconnectHydratedSession({
						source,
						panelId,
						requestedSessionId: sessionId,
						canonicalSessionId: hydration.canonicalSessionId,
						openToken: hydration.openToken,
						sessionStore,
					});
					return okAsync(undefined);
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
						agentId: sessionIdentity.agentId,
						error,
					});
					return reattachLocalCreatedSession({
						source,
						panelId,
						sessionId,
						sessionStore,
						agentId: sessionIdentity.agentId,
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
			if (reconnectPromise === null) {
				inflightPanelIds.delete(panelId);
				return;
			}
			reconnectPromise.finally(() => {
				inflightPanelIds.delete(panelId);
			});
		});
}

export function __resetOpenPersistedSessionForTests(): void {
	inflightPanelIds.clear();
}
