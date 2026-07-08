/**
 * AgentPanelSessionController — owns the agent panel's session-derived reactive
 * state, hoisted out of the `agent-panel.svelte` god controller.
 *
 * Built incrementally across clusters (see
 * docs/plans/2026-05-29-002-refactor-agent-panel-session-controller-plan.md):
 *   - U1 (this commit): scaffold + accessor-dep constructor + scalar passthrough.
 *   - U2: identity/metadata derivations.
 *   - U3: canonical session-status derivations.
 *   - U4: error/connection state + mutators.
 *
 * Reactive scalars (`sessionId`, `panelId`) are passed as accessor functions so
 * the controller's `$derived` fields recompute when the underlying component
 * reactive sources change. Object/array-producing derivations MUST be
 * `$derived`/`$derived.by` FIELDS (not plain getters) to preserve memoization
 * and reference identity — see Decision 3 in the plan.
 */

import { deriveLocalReferenceId } from "$lib/errors/error-reference.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import {
	type PanelConnectionErrorDetails,
	PanelConnectionState,
} from "../../../types/panel-connection-state.js";
import { extractAttachmentsFromChunks } from "../../../utils/extract-content-attachments.js";
import { shouldDisableSendForFailedFirstSend } from "../../agent-input/logic/first-send-recovery.js";
import {
	type PlanningDebugSnapshot,
	registerPlanningDebugSource,
	unregisterPlanningDebugSource,
} from "./planning-debug.js";
import {
	deriveCanonicalAgentPanelSessionState,
	deriveCanonicalUserEntryPresence,
	derivePanelErrorInfo,
	resolveCanonicalAgentPanelTurnState,
	resolveOptimisticHeaderTitle,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "../logic";
import { contentBlocksToText } from "../scene/assistant-content.js";

export interface AgentPanelSessionControllerDeps {
	getSessionId: () => string | null;
	getPanelId: () => string | undefined;
	sessionStore: SessionStore;
	panelStore: PanelStore;
	/**
	 * Connection state + agent name stay as component `$state`/`$derived` (the
	 * retry/cancel/dismiss handlers are tangled with component DOM refs), so the
	 * error derivations read them through accessors.
	 */
	getPanelConnectionState: () => PanelConnectionState | null;
	getPanelConnectionError: () => PanelConnectionErrorDetails | null;
	getAgentName: () => string | null;
}

export class AgentPanelSessionController {
	readonly #deps: AgentPanelSessionControllerDeps;

	constructor(deps: AgentPanelSessionControllerDeps) {
		this.#deps = deps;
		// Dev-only planning-indicator instrumentation. Pull-based: the thunk only
		// runs when window.__acepePlanningSnapshot() is invoked. Bounded by panel
		// instance (keyed by `this`).
		registerPlanningDebugSource(this, () => this.#planningDebugSnapshot());
	}

	/** Detach this controller's planning-debug thunk (call on component teardown). */
	dispose(): void {
		unregisterPlanningDebugSource(this);
	}

	#planningDebugSnapshot(): PlanningDebugSnapshot {
		const source = this.canonicalPanelSessionSource;
		const turnState = this.sessionTurnState;
		return {
			sessionId: this.#deps.getSessionId(),
			sourceKind: source.kind,
			lifecycleStatus: source.kind === "canonical" ? source.lifecycle.status : null,
			activityKind: this.canonicalSessionActivity?.kind ?? null,
			turnState: turnState === null ? null : String(turnState),
			hasOptimisticPendingEntry: this.preSessionPendingUserEntry !== null,
			hasLocalPendingSendIntent: this.sessionPendingSendIntent !== null,
			pendingSendIntentAttemptId: this.sessionPendingSendIntent?.attemptId ?? null,
			hasMessages: this.hasMessages,
			visibleEntryCount: this.knownVisibleEntryCount,
			showPlanningIndicator: this.showPlanningIndicator,
			actionabilityCanSend:
				source.kind === "canonical" ? source.lifecycle.actionability.canSend : null,
			sessionCanSubmit: this.sessionCanSubmit,
			disableSendForFailedFirstSend: this.disableSendForFailedFirstSend,
			capturedAtMs: Date.now(),
		};
	}

	/** Cheap scalar passthrough — a plain getter is correct here (no memoized object). */
	get sessionId(): string | null {
		return this.#deps.getSessionId();
	}

	// ── Cluster A: session identity / metadata ──────────────────────────
	// Object-producing derivations are $derived FIELDS (not getters) so they
	// keep memoization + reference identity (plan Decision 3). The $derived.by
	// closures read this.#deps lazily on first access, after the constructor
	// has assigned it.

	/** Identity: id, projectPath, agentId, worktreePath (immutable - never changes). */
	readonly sessionIdentity = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionIdentity(id) : null;
	});

	/** Metadata: title, createdAt, updatedAt (rarely changes). */
	readonly sessionMetadata = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionMetadata(id) : null;
	});

	readonly sessionProjectPath = $derived(this.sessionIdentity?.projectPath ?? null);
	readonly sessionAgentId = $derived(this.sessionIdentity?.agentId ?? null);
	readonly sessionWorktreePath = $derived(this.sessionIdentity?.worktreePath ?? null);
	readonly sessionTitle = $derived(this.sessionMetadata?.title ?? null);

	/** Current model from canonical capabilities (for PR popover default). */
	readonly sessionCurrentModelId = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionCurrentModelId(id) : null;
	});

	/** Panel id with the default-panel fallback. */
	readonly effectivePanelId = $derived.by(() => this.#deps.getPanelId() ?? "default-panel");

	// ── Cluster B: entry presence + canonical session status ────────────
	// All fields use $derived.by so their bodies read this.#deps / sibling
	// fields lazily, avoiding field-initialization-order pitfalls.

	readonly panelHotState = $derived.by(() => {
		const pid = this.#deps.getPanelId();
		return pid ? this.#deps.panelStore.getHotState(pid) : null;
	});

	readonly sessionPendingSendIntent = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionPendingSendIntent(id) : null;
	});

	readonly preSessionPendingUserEntry = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id === null || id === undefined ? (this.panelHotState?.pendingUserEntry ?? null) : null;
	});

	/**
	 * Optimistic header title for the whole pre-canonical window. Derived from
	 * the pending first user message — sourced from the pre-session hot entry
	 * (no session id yet) OR the pending-send-intent's optimistic entry (session
	 * id exists but canonical not yet materialized, sourceKind "missing_canonical")
	 * — so the header reads the message from t=0 through canonical promotion
	 * without reverting to the generic placeholder. Defers to canonical the
	 * instant a real (non-fallback) title exists.
	 */
	readonly optimisticHeaderTitle = $derived.by((): string | null => {
		const entry =
			this.preSessionPendingUserEntry ?? this.sessionPendingSendIntent?.optimisticEntry ?? null;
		const pendingUserMessageText =
			entry !== null && entry.type === "user"
				? contentBlocksToText(entry.message.chunks ?? [])
				: null;
		return resolveOptimisticHeaderTitle({
			canonicalTitle: this.sessionTitle,
			pendingUserMessageText,
		});
	});

	/**
	 * Sign-in requirement for the panel. Merges two sources:
	 *
	 * 1. **Hot-state** (`panelHotState.signInRequirement`): set on the pre-session
	 *    creation path when `AuthenticationRequired` is returned before a session
	 *    node exists. Carries the exact agent name and instructions from the Rust
	 *    error.
	 *
	 * 2. **Canonical lifecycle** (`Detached(AwaitingAuthentication)`): set on the
	 *    resume path when an existing session parks awaiting auth. We derive the
	 *    copy from the agent display name alone (the instructions aren't stored in
	 *    the lifecycle graph — the sign-in flow is agent-specific and static).
	 *
	 * Hot-state takes precedence (it carries richer copy). Neither is an error —
	 * both render as a neutral sign-in card above the composer.
	 */
	readonly signInRequirement = $derived.by((): { agent: string; instructions: string } | null => {
		const fromHotState = this.panelHotState?.signInRequirement ?? null;
		if (fromHotState !== null) {
			return fromHotState;
		}
		const sessionId = this.#deps.getSessionId();
		if (sessionId === null) {
			return null;
		}
		const detachedReason =
			this.#deps.sessionStore.read.getSessionLifecycleDetachedReason(sessionId);
		if (detachedReason !== "awaitingAuthentication") {
			return null;
		}
		const agentName = this.#deps.getAgentName() ?? "the agent";
		return {
			agent: agentName,
			instructions: `Complete the ${agentName} sign-in in your terminal, then retry.`,
		};
	});

	readonly canonicalTranscriptEntries = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id === null || id === undefined
			? null
			: this.#deps.sessionStore.read.getSessionTranscriptEntries(id);
	});

	readonly canonicalUserEntryPresence = $derived.by(() => {
		const pending = this.sessionPendingSendIntent;
		const id = this.#deps.getSessionId();
		const transcriptEntries =
			id === null || id === undefined ? [] : this.canonicalTranscriptEntries;
		return deriveCanonicalUserEntryPresence({
			transcriptEntries,
			pendingAttemptId: pending?.attemptId ?? null,
		});
	});

	readonly optimisticUserEntryForGraph = $derived.by(() =>
		resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: this.panelHotState?.pendingUserEntry ?? null,
			sessionPendingOptimisticEntry: this.sessionPendingSendIntent?.optimisticEntry ?? null,
			hasCanonicalUserEntry: this.canonicalUserEntryPresence.hasCanonicalUserEntry,
			hasCanonicalMatchingPendingUserEntry:
				this.canonicalUserEntryPresence.hasCanonicalMatchingPendingUserEntry,
		})
	);

	readonly hasImmediatePendingSendIntent = $derived.by(
		() => this.sessionPendingSendIntent !== null || this.optimisticUserEntryForGraph !== null
	);

	readonly firstMessageAttachments = $derived.by(() => {
		const firstUserEntry =
			this.preSessionPendingUserEntry ?? this.sessionPendingSendIntent?.optimisticEntry ?? null;
		if (!firstUserEntry || firstUserEntry.type !== "user") return [];
		return extractAttachmentsFromChunks(firstUserEntry.message.chunks ?? []);
	});

	readonly visibleEntryCount = $derived.by(() => {
		const id = this.#deps.getSessionId();
		const rowsProjection =
			id === null || id === undefined
				? null
				: this.#deps.sessionStore.viewport.getRowsProjection(id);
		return resolveVisibleEntryCount({
			canonicalEntryCount:
				id === null || id === undefined ? 0 : (this.canonicalTranscriptEntries?.length ?? null),
			canonicalMessageCount:
				id === null || id === undefined
					? 0
					: this.#deps.sessionStore.read.getSessionMessageCount(id),
			canonicalViewportRowCount:
				rowsProjection?.sessionId === id ? rowsProjection.rows.length : null,
			optimisticUserEntry: this.optimisticUserEntryForGraph,
		});
	});

	readonly knownVisibleEntryCount = $derived.by(() => this.visibleEntryCount ?? 0);
	readonly hasMessages = $derived.by(
		() => this.visibleEntryCount !== null && this.visibleEntryCount > 0
	);

	/** Canonical lifecycle presentation from Rust-owned graph projection. */
	readonly lifecyclePresentation = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.presentation.getSessionLifecyclePresentation(id) : null;
	});

	readonly agentPanelCanonicalSource = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.presentation.getSessionAgentPanelCanonicalSource(id) : null;
	});

	readonly canonicalPanelSessionSource = $derived.by(() =>
		this.#deps.sessionStore.presentation.getSessionAgentPanelSessionSource(this.#deps.getSessionId())
	);

	readonly canonicalSessionActivity = $derived.by(() =>
		this.canonicalPanelSessionSource.kind === "canonical"
			? this.canonicalPanelSessionSource.activity
			: null
	);

	readonly sessionTurnState = $derived.by(() =>
		resolveCanonicalAgentPanelTurnState(this.canonicalPanelSessionSource)
	);

	readonly hasActiveStreamingTail = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id !== null && this.#deps.sessionStore.read.getActiveStreamingTailRowId(id) !== null;
	});

	readonly canonicalPanelSessionState = $derived.by(() =>
		deriveCanonicalAgentPanelSessionState({
			source: this.canonicalPanelSessionSource,
			hasEntries: this.hasMessages,
			hasOptimisticPendingEntry: this.preSessionPendingUserEntry !== null,
			hasLocalPendingSendIntent: this.sessionPendingSendIntent !== null,
			hasActiveStreamingTail: this.hasActiveStreamingTail,
		})
	);

	readonly panelSessionStatus = $derived.by(() => this.canonicalPanelSessionState.sessionStatus);
	readonly sessionIsConnected = $derived.by(() => this.canonicalPanelSessionState.isConnected);
	readonly sessionIsStreaming = $derived.by(() => this.canonicalPanelSessionState.isStreaming);
	readonly isAwaitingModelResponse = $derived.by(
		() => this.canonicalSessionActivity?.kind === "awaiting_model"
	);
	readonly showPlanningIndicator = $derived.by(
		() => this.canonicalPanelSessionState.showPlanningIndicator
	);
	readonly sessionCanSubmit = $derived.by(() => this.canonicalPanelSessionState.canSubmit);
	readonly sessionShowStop = $derived.by(() => this.canonicalPanelSessionState.showStop);

	// ── Cluster C: error / connection derivations ───────────────────────
	// Connection $state + the retry/cancel/dismiss handlers stay in the
	// component (tangled with the agent-input DOM ref); these derivations read
	// that state via accessors. The retry-busy $effect is eliminated in favour
	// of `stillFailed` + a component-side `$derived` (plan Decision 7).

	readonly sessionConnectionError = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionConnectionError(id) : null;
	});

	readonly sessionFailureReason = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.read.getSessionLifecycleFailureReason(id) : null;
	});

	readonly activeTurnError = $derived.by(() => {
		const id = this.#deps.getSessionId();
		const activeTurnFailure = id ? this.#deps.sessionStore.read.getSessionActiveTurnFailure(id) : null;
		if (activeTurnFailure) {
			return {
				content: activeTurnFailure.message,
				code: activeTurnFailure.code ?? undefined,
				kind: activeTurnFailure.kind,
				source: activeTurnFailure.source,
			};
		}
		return null;
	});

	readonly disableSendForFailedFirstSend = $derived.by(() => {
		const panelConnectionState = this.#deps.getPanelConnectionState();
		return panelConnectionState
			? shouldDisableSendForFailedFirstSend({
					hasSession: Boolean(this.#deps.getSessionId()),
					panelConnectionState,
				})
			: false;
	});

	readonly errorInfo = $derived.by(() =>
		derivePanelErrorInfo({
			panelConnectionState: this.#deps.getPanelConnectionState(),
			panelConnectionError: this.#deps.getPanelConnectionError(),
			sessionConnectionError: this.sessionConnectionError,
			sessionTurnState: this.sessionTurnState,
			activeTurnError: this.activeTurnError,
			sessionFailureReason: this.sessionFailureReason,
			agentDisplayName: this.#deps.getAgentName(),
		})
	);

	readonly fallbackInlineErrorReferenceId = $derived.by(() => {
		if (!this.errorInfo.showError || this.errorInfo.details === null) {
			return null;
		}
		if (this.errorInfo.referenceId !== null) {
			return null;
		}
		return deriveLocalReferenceId(`${this.errorInfo.title}|${this.errorInfo.details}`);
	});

	readonly inlineErrorReferenceId = $derived.by(
		() => this.errorInfo.referenceId ?? this.fallbackInlineErrorReferenceId
	);

	readonly inlineErrorReferenceSearchable = $derived.by(() =>
		this.errorInfo.referenceId !== null ? this.errorInfo.referenceSearchable : false
	);

	readonly errorDismissalKey = $derived.by(() =>
		this.errorInfo.showError
			? `${this.errorInfo.failureReason ?? "none"}::${this.errorInfo.details ?? ""}`
			: null
	);

	/**
	 * Whether the session is still in a failed state — drives the retry-busy
	 * derivation in the component (replaces the former clearing $effect).
	 */
	readonly stillFailed = $derived.by(
		() =>
			this.errorInfo.showError ||
			this.activeTurnError !== null ||
			this.sessionTurnState === "error" ||
			this.#deps.getPanelConnectionState() === PanelConnectionState.ERROR
	);
}
