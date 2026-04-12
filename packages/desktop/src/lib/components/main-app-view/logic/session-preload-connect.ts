import { okAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionProjectionHydrator } from "$lib/acp/store/services/session-projection-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";

const logger = createLogger({ id: "session-preload-connect", name: "SessionPreloadConnect" });
const inflightSessionIds = new Set<string>();

type SessionPreloadStore = Pick<
	SessionStore,
	"setSessionLoading" | "preloadSessions" | "removeSession" | "setSessionLoaded" | "connectSession"
>;

interface SessionPreloadConnectOptions {
	readonly sessionId: string;
	readonly sessionStore: SessionPreloadStore;
	readonly projectionHydrator: Pick<SessionProjectionHydrator, "hydrateSession" | "clearSession">;
	readonly panelStore: Pick<PanelStore, "closePanelBySessionId">;
	readonly timeoutMs: number;
	readonly source: "session-handler" | "panels-container";
}

/**
 * Preload session entries from disk and connect to ACP.
 *
 * This runs in the background:
 * - Marks content loading state
 * - Marks sessions as loaded (empty) when disk content is missing
 * - Auto-connects all agents after preload succeeds
 */
export function preloadAndConnectSession(options: SessionPreloadConnectOptions): void {
	const { sessionId, sessionStore, projectionHydrator, timeoutMs, source } = options;
	if (inflightSessionIds.has(sessionId)) {
		logger.debug("Skipping duplicate preload/connect request", {
			source,
			sessionId,
		});
		return;
	}

	inflightSessionIds.add(sessionId);
	sessionStore.setSessionLoading(sessionId);

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error("Session preload timed out")), timeoutMs);
	});

	const preloadPromise = sessionStore
		.preloadSessions([sessionId])
		.andThen((result) => {
			if (result.missing.includes(sessionId)) {
				logger.warn(
					"Session preload returned missing, marking as loaded and connecting empty session",
					{
						source,
						sessionId,
					}
				);
				projectionHydrator.clearSession(sessionId);
				sessionStore.setSessionLoaded(sessionId);
				sessionStore
					.connectSession(sessionId)
					.andThen(() => projectionHydrator.hydrateSession(sessionId))
					.mapErr((error: AppError) => {
						logger.warn("Failed to connect session after missing preload", {
							source,
							sessionId,
							error,
						});
					});
				return okAsync(undefined);
			}

			return projectionHydrator
				.hydrateSession(sessionId, {
					includePendingTurnInputs: false,
				})
				.andThen(() => {
					sessionStore.setSessionLoaded(sessionId);
					sessionStore
						.connectSession(sessionId)
						.andThen(() => projectionHydrator.hydrateSession(sessionId))
						.mapErr((error: AppError) => {
							logger.warn("Failed to connect session after preload", {
								source,
								sessionId,
								error,
							});
						});
					return okAsync(undefined);
				});
		})
		.match(
			() => undefined,
			(error: AppError) => {
				sessionStore.setSessionLoaded(sessionId);
				logger.error("Failed to preload session", {
					source,
					sessionId,
					error,
				});
			}
		);

	Promise.race([preloadPromise, timeoutPromise])
		.catch(() => {
			sessionStore.setSessionLoaded(sessionId);
			logger.error("Session preload timed out", {
				source,
				sessionId,
				timeoutMs,
			});
		})
		.finally(() => {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			inflightSessionIds.delete(sessionId);
		});
}
