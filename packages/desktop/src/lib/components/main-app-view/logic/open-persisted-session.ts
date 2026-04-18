import { okAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { api } from "$lib/acp/store/api.js";
import { createLogger } from "$lib/acp/utils/logger.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelIds = new Set<string>();

type SessionOpenStore = Pick<
	SessionStore,
	"setSessionLoading" | "setSessionLoaded" | "getSessionCold" | "connectSession"
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
				sessionStore.setSessionLoaded(sessionId);
				logger.warn("Session open returned missing", {
					source,
					panelId,
					sessionId,
				});
				return okAsync(undefined);
			}

			if (result.outcome === "error") {
				sessionOpenHydrator.clearAttempt(panelId);
				sessionStore.setSessionLoaded(sessionId);
				logger.warn("Session open returned retryable error", {
					source,
					panelId,
					sessionId,
					message: result.message,
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
