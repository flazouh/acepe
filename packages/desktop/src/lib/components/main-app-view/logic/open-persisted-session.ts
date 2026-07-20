import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { api } from "$lib/acp/store/api.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { SessionOpenResult, SessionOpenResultTiming } from "$lib/services/acp-types.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelSessions = new Map<string, string>();

export type OpenPersistedSessionDiagnosticStage =
	| "started"
	| "skipped-duplicate"
	| "stale-panel"
	| "missing-metadata"
	| "request-started"
	| "result-preparing"
	| "result-missing"
	| "result-error"
	| "result-found"
	| "hydrated"
	| "request-failed"
	| "timed-out"
	| "finished";

export type OpenPersistedSessionDiagnosticEvent = {
	readonly stage: OpenPersistedSessionDiagnosticStage;
	readonly source: OpenPersistedSessionOptions["source"];
	readonly panelId: string;
	readonly sessionId: string;
	readonly elapsedMs: number;
	readonly canonicalSessionId: string | null;
	readonly outcome: string | null;
	readonly message: string | null;
	readonly hasSessionIdentity: boolean | null;
	readonly hasSessionMetadata: boolean | null;
	readonly shouldAttemptLocalReattach: boolean | null;
	readonly hasInitialViewportEnvelope: boolean | null;
	readonly initialRowPageRowCount: number | null;
	readonly initialRowPageTotalRowCount: number | null;
	readonly initialRowPageStartRowIndex: number | null;
	readonly initialRowPagePayloadBytes: number | null;
	readonly openResultTiming: SessionOpenResultTiming | null;
};

type OpenPersistedSessionDiagnosticRecorder = (event: OpenPersistedSessionDiagnosticEvent) => void;

let diagnosticRecorder: OpenPersistedSessionDiagnosticRecorder | null = null;

type SessionOpenStore = Pick<SessionStore, "read" | "loading" | "connection">;

type SessionOpenHydratorLike = Pick<
	SessionOpenHydrator,
	"beginAttempt" | "clearAttempt" | "hydrateFound" | "isCurrentAttempt"
> & {
	readonly hydrateFoundNow?: SessionOpenHydrator["hydrateFoundNow"];
};

interface OpenPersistedSessionOptions {
	readonly panelId: string;
	readonly sessionId: string;
	readonly sessionStore: SessionOpenStore;
	readonly sessionOpenHydrator: SessionOpenHydratorLike;
	readonly getSessionOpenResult?: typeof api.getSessionOpenResult;
	readonly awaitSessionOpenRepair?: typeof api.awaitSessionOpenRepair;
	readonly preparedOpenResult?: SessionOpenResult;
	readonly repairPriority?: "selected" | "visible";
	readonly isPanelCurrent?: (panelId: string, sessionId: string) => boolean;
	readonly timeoutMs: number;
	readonly source: "initialization-manager" | "session-handler";
}

function roundDiagnosticMs(value: number): number {
	return Math.round(value * 100) / 100;
}

export function setOpenPersistedSessionDiagnosticRecorder(
	recorder: OpenPersistedSessionDiagnosticRecorder | null
): () => void {
	const previousRecorder = diagnosticRecorder;
	diagnosticRecorder = recorder;
	return () => {
		diagnosticRecorder = previousRecorder;
	};
}

function isProviderHistoryBackedSession(
	sessionMetadata: NonNullable<ReturnType<SessionOpenStore["read"]["getSessionMetadata"]>>
): boolean {
	return sessionMetadata.sessionLifecycleState !== "created" || Boolean(sessionMetadata.sourcePath);
}

function reattachLocalCreatedSession(input: {
	readonly source: OpenPersistedSessionOptions["source"];
	readonly panelId: string;
	readonly sessionId: string;
	readonly sessionStore: SessionOpenStore;
	readonly agentId: string;
}): ResultAsync<void, AppError> {
	const { source, panelId, sessionId, sessionStore, agentId } = input;
	return sessionStore.connection
		.connectSession(sessionId)
		.map(() => {
			sessionStore.loading.setLocalCreatedSessionLoaded(sessionId);
			logger.debug("Reattached local created session", {
				source,
				panelId,
				sessionId,
				agentId,
			});
			return undefined;
		})
		.orElse((error: AppError) => {
			sessionStore.loading.setSessionLoaded(sessionId);
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
		source,
		getSessionOpenResult = api.getSessionOpenResult,
		awaitSessionOpenRepair = api.awaitSessionOpenRepair,
		preparedOpenResult,
		repairPriority = "selected",
		isPanelCurrent,
	} = options;
	const startedAtMs = performance.now();
	const recordDiagnostic = (
		stage: OpenPersistedSessionDiagnosticStage,
		input?: {
			readonly canonicalSessionId?: string | null;
			readonly outcome?: string | null;
			readonly message?: string | null;
			readonly hasSessionIdentity?: boolean | null;
			readonly hasSessionMetadata?: boolean | null;
			readonly shouldAttemptLocalReattach?: boolean | null;
			readonly hasInitialViewportEnvelope?: boolean | null;
			readonly initialRowPageRowCount?: number | null;
			readonly initialRowPageTotalRowCount?: number | null;
			readonly initialRowPageStartRowIndex?: number | null;
			readonly initialRowPagePayloadBytes?: number | null;
			readonly openResultTiming?: SessionOpenResultTiming | null;
		}
	): void => {
		if (diagnosticRecorder === null) {
			return;
		}
		diagnosticRecorder({
			stage,
			source,
			panelId,
			sessionId,
			elapsedMs: roundDiagnosticMs(performance.now() - startedAtMs),
			canonicalSessionId: input?.canonicalSessionId ?? null,
			outcome: input?.outcome ?? null,
			message: input?.message ?? null,
			hasSessionIdentity: input?.hasSessionIdentity ?? null,
			hasSessionMetadata: input?.hasSessionMetadata ?? null,
			shouldAttemptLocalReattach: input?.shouldAttemptLocalReattach ?? null,
			hasInitialViewportEnvelope: input?.hasInitialViewportEnvelope ?? null,
			initialRowPageRowCount: input?.initialRowPageRowCount ?? null,
			initialRowPageTotalRowCount: input?.initialRowPageTotalRowCount ?? null,
			initialRowPageStartRowIndex: input?.initialRowPageStartRowIndex ?? null,
			initialRowPagePayloadBytes: input?.initialRowPagePayloadBytes ?? null,
			openResultTiming: input?.openResultTiming ?? null,
		});
	};
	if (inflightPanelSessions.get(panelId) === sessionId) {
		recordDiagnostic("skipped-duplicate");
		logger.debug("Skipping duplicate session-open request", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const panelStillTargetsSession = (): boolean => isPanelCurrent?.(panelId, sessionId) ?? true;

	if (!panelStillTargetsSession()) {
		recordDiagnostic("stale-panel");
		logger.debug("Skipping stale session-open request", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const sessionIdentity = sessionStore.read.getSessionIdentity(sessionId);
	const sessionMetadata = sessionStore.read.getSessionMetadata(sessionId);
	if (!sessionIdentity || !sessionMetadata) {
		recordDiagnostic("missing-metadata", {
			hasSessionIdentity: Boolean(sessionIdentity),
			hasSessionMetadata: Boolean(sessionMetadata),
		});
		logger.warn("Cannot open session because metadata is missing", {
			source,
			panelId,
			sessionId,
		});
		return;
	}

	const shouldAttemptLocalReattach = !isProviderHistoryBackedSession(sessionMetadata);
	recordDiagnostic("started", {
		hasSessionIdentity: true,
		hasSessionMetadata: true,
		shouldAttemptLocalReattach,
	});

	inflightPanelSessions.set(panelId, sessionId);
	sessionStore.loading.setSessionLoading(sessionId);
	const requestToken = sessionOpenHydrator.beginAttempt(panelId);

	recordDiagnostic("request-started", {
		shouldAttemptLocalReattach,
	});
	const handleOpenResult = (result: SessionOpenResult): ResultAsync<void, AppError> => {
		if (!panelStillTargetsSession()) {
			sessionStore.loading.setSessionLoaded(sessionId);
			recordDiagnostic("stale-panel", {
				outcome: result.outcome,
				canonicalSessionId: result.outcome === "found" ? result.canonicalSessionId : null,
				shouldAttemptLocalReattach,
				openResultTiming: result.outcome === "found" ? (result.openResultTiming ?? null) : null,
			});
			logger.debug("Ignoring stale session-open result", {
				source,
				panelId,
				sessionId,
				outcome: result.outcome,
			});
			return okAsync(undefined);
		}
		if (result.outcome === "preparing") {
			recordDiagnostic("result-preparing", {
				outcome: result.outcome,
				shouldAttemptLocalReattach,
			});
			return awaitSessionOpenRepair(result.repairTicket).andThen((repairedResult) =>
				handleOpenResult(repairedResult)
			);
		}

		if (result.outcome === "missing") {
			recordDiagnostic("result-missing", {
				outcome: result.outcome,
				shouldAttemptLocalReattach,
			});
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
			sessionStore.loading.setSessionLoaded(sessionId);
			return okAsync(undefined);
		}

		if (result.outcome === "error") {
			recordDiagnostic("result-error", {
				outcome: result.outcome,
				message: result.message,
				shouldAttemptLocalReattach,
			});
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
			sessionStore.loading.setSessionLoaded(sessionId);
			return okAsync(undefined);
		}

		const initialRowPage = result.initialTranscriptRowPage ?? null;
		recordDiagnostic("result-found", {
			outcome: result.outcome,
			canonicalSessionId: result.canonicalSessionId,
			shouldAttemptLocalReattach,
			hasInitialViewportEnvelope:
				result.initialViewportEnvelope !== null && result.initialViewportEnvelope !== undefined,
			initialRowPageRowCount: initialRowPage?.rows.length ?? null,
			initialRowPageTotalRowCount: initialRowPage?.totalRowCount ?? null,
			initialRowPageStartRowIndex: initialRowPage?.startRowIndex ?? null,
			initialRowPagePayloadBytes: initialRowPage?.rowPayloadBytes ?? null,
			openResultTiming: result.openResultTiming ?? null,
		});
		const finishHydration = (hydration: {
			readonly canonicalSessionId: string;
			readonly openToken: string;
			readonly applied: boolean;
		}) => {
			if (!sessionOpenHydrator.isCurrentAttempt(panelId, requestToken)) {
				return okAsync(undefined);
			}

			if (
				!hydration.applied &&
				sessionStore.read.getSessionCanSend(hydration.canonicalSessionId) === true
			) {
				sessionStore.loading.setSessionLoaded(hydration.canonicalSessionId);
				sessionOpenHydrator.clearAttempt(panelId);
				return okAsync(undefined);
			}

			return sessionStore.connection
				.connectSession(hydration.canonicalSessionId, {
					openToken: hydration.openToken,
					forceReconnect: true,
				})
				.map(() => {
					sessionStore.loading.setSessionLoaded(hydration.canonicalSessionId);
					sessionOpenHydrator.clearAttempt(panelId);
					recordDiagnostic("hydrated", {
						canonicalSessionId: hydration.canonicalSessionId,
						shouldAttemptLocalReattach,
					});
				});
		};
		const immediateHydration = sessionOpenHydrator.hydrateFoundNow?.(panelId, requestToken, result);
		if (immediateHydration !== undefined) {
			if (immediateHydration.isErr()) {
				return errAsync(immediateHydration.error);
			}
			if (immediateHydration.value !== null) {
				return finishHydration(immediateHydration.value);
			}
		}
		return sessionOpenHydrator
			.hydrateFound(panelId, requestToken, result)
			.andThen((hydration) => finishHydration(hydration));
	};

	const openResult = preparedOpenResult
		? handleOpenResult(preparedOpenResult)
		: getSessionOpenResult(
				sessionId,
				sessionIdentity.projectPath,
				sessionIdentity.agentId,
				sessionMetadata.sourcePath,
				repairPriority
			).andThen((result) => handleOpenResult(result));

	const openPromise = openResult.match(
		() => undefined,
		(error: AppError) => {
			recordDiagnostic("request-failed", {
				message: error.message,
				shouldAttemptLocalReattach,
			});
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
			sessionStore.loading.setSessionLoaded(sessionId);
			logger.error("Failed to open session", {
				source,
				panelId,
				sessionId,
				error,
			});
		}
	);

	openPromise.finally(() => {
		if (inflightPanelSessions.get(panelId) === sessionId) {
			inflightPanelSessions.delete(panelId);
		}
		recordDiagnostic("finished", {
			shouldAttemptLocalReattach,
		});
	});
}

export function __resetOpenPersistedSessionForTests(): void {
	inflightPanelSessions.clear();
	diagnosticRecorder = null;
}
