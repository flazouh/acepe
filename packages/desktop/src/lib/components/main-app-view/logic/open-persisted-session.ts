import { okAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { api } from "$lib/acp/store/api.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { SessionOpenResult } from "$lib/services/acp-types.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelIds = new Set<string>();

type SessionOpenStore = Pick<
	SessionStore,
	| "setSessionLoading"
	| "setSessionLoaded"
	| "setLocalCreatedSessionLoaded"
	| "setSessionOpenMissing"
	| "getSessionCold"
	| "getLocalPersistedSessionProbeStatus"
	| "setLocalPersistedSessionProbeStatus"
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

const PERMANENT_LOCAL_REATTACH_ERROR_MARKERS = [
	"This saved session is no longer available to reopen",
	"Resource not found: Session",
] as const;

function missingSessionMessage(session: ReturnType<SessionOpenStore["getSessionCold"]>): string {
	if (session?.agentId === "cursor" && session.sourcePath?.endsWith("store.db")) {
		return "This Cursor history session is view-only and can't be reopened because no canonical resumable state was persisted.";
	}

	return "This session can't be reopened yet because provider history isn't available. Retry once the provider has flushed the session history.";
}

function errorSessionMessage(result: Extract<SessionOpenResult, { outcome: "error" }>): string {
	if (result.reason === "parseFailure") {
		return "This session can't be reopened because the provider history could not be parsed.";
	}

	if (result.retryable) {
		return "This session couldn't be reopened because Acepe hit an internal error while loading it. Try again in a moment.";
	}

	return "This session couldn't be reopened because Acepe hit an internal error while loading it.";
}

function localCreatedReattachUnavailableMessage(
	session: ReturnType<SessionOpenStore["getSessionCold"]>
): string {
	if (session?.agentId === "cursor") {
		return "This Cursor session is no longer available to reopen. Start a new session to continue.";
	}

	if (session?.agentId === "copilot") {
		return "This GitHub Copilot session is no longer available to reopen. Start a new session to continue.";
	}

	return "This saved session is no longer available to reopen. Start a new session to continue.";
}

function isProviderHistoryBackedSession(session: ReturnType<SessionOpenStore["getSessionCold"]>): boolean {
	return session?.sessionLifecycleState !== "created" || Boolean(session.sourcePath);
}

function errorDetails(error: AppError): string {
	const causeMessage = error.cause instanceof Error ? error.cause.message : "";
	return causeMessage.length > 0 ? `${error.message}\n${causeMessage}` : error.message;
}

function isPermanentLocalReattachFailure(message: string | null): boolean {
	if (message === null) {
		return false;
	}

	return PERMANENT_LOCAL_REATTACH_ERROR_MARKERS.some((marker) => message.includes(marker));
}

function setLocalReattachFailureIfPermanent(
	sessionStore: SessionOpenStore,
	sessionId: string,
	details: string
): void {
	if (isPermanentLocalReattachFailure(details)) {
		sessionStore.setLocalPersistedSessionProbeStatus(sessionId, "permanent-reattach-failure");
	}
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

	if (!isProviderHistoryBackedSession(session)) {
		if (
			sessionStore.getLocalPersistedSessionProbeStatus(sessionId) ===
			"permanent-reattach-failure"
		) {
			sessionStore.setSessionOpenMissing(sessionId, localCreatedReattachUnavailableMessage(session));
			logger.debug("Skipping permanent failed local-created session reattach", {
				source,
				panelId,
				sessionId,
				agentId: session.agentId,
			});
			return;
		}

		sessionStore.setLocalPersistedSessionProbeStatus(sessionId, "none");
		sessionStore.setLocalCreatedSessionLoaded(sessionId);
		void sessionStore.connectSession(sessionId).match(
			() => {
				sessionStore.setLocalPersistedSessionProbeStatus(sessionId, "none");
				logger.debug("Reattached local created session", {
					source,
					panelId,
					sessionId,
					agentId: session.agentId,
				});
			},
			(error: AppError) => {
				const details = errorDetails(error);
				const permanentLocalReattachFailure = isPermanentLocalReattachFailure(details);
				setLocalReattachFailureIfPermanent(sessionStore, sessionId, details);
				if (permanentLocalReattachFailure) {
					sessionStore.setSessionOpenMissing(
						sessionId,
						localCreatedReattachUnavailableMessage(session)
					);
				}
				logger.warn("Failed to reattach local created session", {
					source,
					panelId,
					sessionId,
					agentId: session.agentId,
					details,
					error,
				});
			}
		);
		logger.debug("Skipping provider-history open for local created session", {
			source,
			panelId,
			sessionId,
			agentId: session.agentId,
		});
		return;
	}

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
				sessionOpenHydrator.clearAttempt(panelId);
				sessionStore.setSessionOpenMissing(sessionId, missingSessionMessage(session));
				logger.warn("Session open returned missing", {
					source,
					panelId,
					sessionId,
				});
				return okAsync(undefined);
			}

			if (result.outcome === "error") {
				sessionOpenHydrator.clearAttempt(panelId);
				sessionStore.setSessionOpenMissing(sessionId, errorSessionMessage(result));
				logger.warn("Session open returned explicit error state", {
					source,
					panelId,
					sessionId,
					message: result.message,
					reason: result.reason,
					retryable: result.retryable,
				});
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
