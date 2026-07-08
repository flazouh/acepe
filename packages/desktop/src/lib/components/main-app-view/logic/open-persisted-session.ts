import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { api } from "$lib/acp/store/api.js";
import type { SessionOpenHydrator } from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import type { SessionOpenResult, SessionOpenResultTiming } from "$lib/services/acp-types.js";

const logger = createLogger({ id: "open-persisted-session", name: "OpenPersistedSession" });
const inflightPanelIds = new Set<string>();
const RECONNECT_PAINT_FRAME_TIMEOUT_MS = 50;

export type OpenPersistedSessionDiagnosticStage =
	| "started"
	| "skipped-duplicate"
	| "stale-panel"
	| "missing-metadata"
	| "request-started"
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
type ReconnectPaintDelay = () => Promise<void>;
let reconnectPaintDelayForTests: ReconnectPaintDelay | null = null;

type SessionOpenStore = Pick<
	SessionStore,
	"read" | "loading" | "connection" | "clearSessionEntries"
>;

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
	readonly preparedOpenResult?: SessionOpenResult;
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

interface HydratedReconnectOptions {
	readonly source: OpenPersistedSessionOptions["source"];
	readonly panelId: string;
	readonly requestedSessionId: string;
	readonly canonicalSessionId: string;
	readonly openToken: string;
	readonly sessionStore: SessionOpenStore;
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

function waitForAnimationFrame(): Promise<void> {
	if (typeof requestAnimationFrame !== "function") {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			resolve();
		};
		timeoutId = setTimeout(finish, RECONNECT_PAINT_FRAME_TIMEOUT_MS);
		requestAnimationFrame(finish);
	});
}

function waitForTimerTurn(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

function shouldDelayReconnectForPaint(): boolean {
	return (
		"__TAURI_INTERNALS__" in globalThis &&
		typeof document !== "undefined" &&
		typeof requestAnimationFrame === "function"
	);
}

function waitForPostPaintOpportunity(): Promise<void> {
	return waitForAnimationFrame()
		.then(() => waitForAnimationFrame())
		.then(() => waitForTimerTurn());
}

function reconnectHydratedSession(input: HydratedReconnectOptions): Promise<void> {
	const { source, panelId, requestedSessionId, canonicalSessionId, openToken, sessionStore } =
		input;
	return sessionStore.connection
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
}

function reconnectHydratedSessionAfterPaint(input: HydratedReconnectOptions): Promise<void> {
	const paintDelay = reconnectPaintDelayForTests ?? waitForPostPaintOpportunity;
	if (reconnectPaintDelayForTests === null && !shouldDelayReconnectForPaint()) {
		return reconnectHydratedSession(input);
	}
	return paintDelay().then(() => reconnectHydratedSession(input));
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
		preparedOpenResult,
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
	if (inflightPanelIds.has(panelId)) {
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

	inflightPanelIds.add(panelId);
	if (isProviderHistoryBackedSession(sessionMetadata)) {
		sessionStore.clearSessionEntries(sessionId);
	}
	sessionStore.loading.setSessionLoading(sessionId);
	const requestToken = sessionOpenHydrator.beginAttempt(panelId);
	let reconnectPromise: Promise<void> | null = null;

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error("Session open timed out")), timeoutMs);
	});

	recordDiagnostic("request-started", {
		shouldAttemptLocalReattach,
	});
	const handleOpenResult = (result: SessionOpenResult): ResultAsync<void, AppError> => {
		if (!panelStillTargetsSession()) {
			sessionOpenHydrator.clearAttempt(panelId);
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
		}) => {
			if (!sessionOpenHydrator.isCurrentAttempt(panelId, requestToken)) {
				return okAsync(undefined);
			}

			sessionStore.loading.setSessionLoaded(hydration.canonicalSessionId);
			sessionOpenHydrator.clearAttempt(panelId);
			recordDiagnostic("hydrated", {
				canonicalSessionId: hydration.canonicalSessionId,
				shouldAttemptLocalReattach,
			});
			reconnectPromise = reconnectHydratedSessionAfterPaint({
				source,
				panelId,
				requestedSessionId: sessionId,
				canonicalSessionId: hydration.canonicalSessionId,
				openToken: hydration.openToken,
				sessionStore,
			});
			return okAsync(undefined);
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
				sessionMetadata.sourcePath
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

	Promise.race([openPromise, timeoutPromise])
		.catch(() => {
			recordDiagnostic("timed-out", {
				message: "Session open timed out",
				shouldAttemptLocalReattach,
			});
			sessionOpenHydrator.clearAttempt(panelId);
			sessionStore.loading.setSessionLoaded(sessionId);
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
				recordDiagnostic("finished", {
					shouldAttemptLocalReattach,
				});
				return;
			}
			reconnectPromise.finally(() => {
				inflightPanelIds.delete(panelId);
				recordDiagnostic("finished", {
					shouldAttemptLocalReattach,
				});
			});
		});
}

export function __resetOpenPersistedSessionForTests(): void {
	inflightPanelIds.clear();
	diagnosticRecorder = null;
	reconnectPaintDelayForTests = null;
}

export function __setOpenPersistedSessionReconnectPaintDelayForTests(
	delay: ReconnectPaintDelay | null
): () => void {
	const previousDelay = reconnectPaintDelayForTests;
	reconnectPaintDelayForTests = delay;
	return () => {
		reconnectPaintDelayForTests = previousDelay;
	};
}
