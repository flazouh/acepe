/**
 * Session State Model
 *
 * Layered discriminated unions for session state that prevent illegal
 * state combinations and simplify classification logic.
 *
 * The model has four orthogonal layers:
 * 1. ConnectionPhase - lifecycle of the connection
 * 2. ActivityState - what the agent is doing
 * 3. PendingInput - user input requests (question/permission)
 * 4. AttentionMeta - attention metadata (unseen completion)
 */

import type { PermissionRequest } from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import type { ToolCall } from "../types/tool-call.js";

// =============================================================================
// Layer 1: Connection Lifecycle
// =============================================================================

/**
 * Connection lifecycle phase.
 *
 * Maps to the XState machine connection region:
 * - disconnected: No active connection (historical session)
 * - connecting: Establishing connection (includes warmup)
 * - connected: Active connection, ready for interaction
 * - error: Connection failed, requires reconnection
 */
export type ConnectionPhase = "disconnected" | "connecting" | "connected" | "error";

// =============================================================================
// Layer 2: Activity State
// =============================================================================

/**
 * What the agent is currently doing.
 *
 * Only meaningful when connected. Each variant carries relevant context.
 */
export type ActivityState =
	| { readonly kind: "idle" }
	| { readonly kind: "thinking" }
	| { readonly kind: "streaming"; readonly modeId: string | null; readonly tool: ToolCall | null }
	| { readonly kind: "paused" };

/** Type guard for idle activity. */
export function isIdleActivity(activity: ActivityState): activity is { kind: "idle" } {
	return activity.kind === "idle";
}

/** Type guard for streaming activity. */
export function isStreamingActivity(
	activity: ActivityState
): activity is { kind: "streaming"; modeId: string | null; tool: ToolCall | null } {
	return activity.kind === "streaming";
}

/** Type guard for thinking activity. */
export function isThinkingActivity(activity: ActivityState): activity is { kind: "thinking" } {
	return activity.kind === "thinking";
}

/** Type guard for paused activity. */
export function isPausedActivity(activity: ActivityState): activity is { kind: "paused" } {
	return activity.kind === "paused";
}

/** Check if activity represents active work (streaming or thinking). */
export function isActiveWork(activity: ActivityState): boolean {
	return activity.kind === "streaming" || activity.kind === "thinking";
}

// =============================================================================
// Layer 3: Pending Input
// =============================================================================

/**
 * Pending user input request.
 *
 * Orthogonal to activity - a question or permission can be pending
 * while the agent is also streaming.
 */
export type PendingInput =
	| { readonly kind: "none" }
	| { readonly kind: "question"; readonly request: QuestionRequest }
	| { readonly kind: "permission"; readonly request: PermissionRequest };

/** Type guard for no pending input. */
export function hasNoPendingInput(input: PendingInput): input is { kind: "none" } {
	return input.kind === "none";
}

/** Type guard for pending question. */
export function hasPendingQuestion(
	input: PendingInput
): input is { kind: "question"; request: QuestionRequest } {
	return input.kind === "question";
}

/** Type guard for pending permission. */
export function hasPendingPermission(
	input: PendingInput
): input is { kind: "permission"; request: PermissionRequest } {
	return input.kind === "permission";
}

/** Check if any input is pending. */
export function hasAnyPendingInput(input: PendingInput): boolean {
	return input.kind !== "none";
}

// =============================================================================
// Layer 4: Attention Metadata
// =============================================================================

/**
 * Attention metadata for the session.
 *
 * Tracks whether the user has seen the latest completion.
 */
export interface AttentionMeta {
	readonly hasUnseenCompletion: boolean;
}

// =============================================================================
// Combined Session State
// =============================================================================

/**
 * Complete session state combining all layers.
 *
 * This is the single source of truth for session UI state.
 */
export interface SessionState {
	readonly connection: ConnectionPhase;
	readonly activity: ActivityState;
	readonly pendingInput: PendingInput;
	readonly attention: AttentionMeta;
}

// =============================================================================
// Factory Functions
// =============================================================================

/** Create an idle activity state. */
export function createIdleActivity(): ActivityState {
	return { kind: "idle" };
}

/** Create a thinking activity state. */
export function createThinkingActivity(): ActivityState {
	return { kind: "thinking" };
}

/** Create a streaming activity state. */
export function createStreamingActivity(
	modeId: string | null,
	tool: ToolCall | null
): ActivityState {
	return { kind: "streaming", modeId, tool };
}

/** Create a paused activity state. */
export function createPausedActivity(): ActivityState {
	return { kind: "paused" };
}

/** Create no pending input. */
export function createNoPendingInput(): PendingInput {
	return { kind: "none" };
}

/** Create a pending question. */
export function createPendingQuestion(request: QuestionRequest): PendingInput {
	return { kind: "question", request };
}

/** Create a pending permission. */
export function createPendingPermission(request: PermissionRequest): PendingInput {
	return { kind: "permission", request };
}

/** Create default attention metadata. */
export function createAttentionMeta(hasUnseenCompletion = false): AttentionMeta {
	return { hasUnseenCompletion };
}

/** Create a default disconnected session state. */
export function createDisconnectedState(): SessionState {
	return {
		connection: "disconnected",
		activity: createIdleActivity(),
		pendingInput: createNoPendingInput(),
		attention: createAttentionMeta(),
	};
}

/** Create a default connecting session state. */
export function createConnectingState(): SessionState {
	return {
		connection: "connecting",
		activity: createIdleActivity(),
		pendingInput: createNoPendingInput(),
		attention: createAttentionMeta(),
	};
}

/** Create a default connected/idle session state. */
export function createConnectedIdleState(): SessionState {
	return {
		connection: "connected",
		activity: createIdleActivity(),
		pendingInput: createNoPendingInput(),
		attention: createAttentionMeta(),
	};
}

/** Create an error session state. */
export function createErrorState(): SessionState {
	return {
		connection: "error",
		activity: createIdleActivity(),
		pendingInput: createNoPendingInput(),
		attention: createAttentionMeta(),
	};
}

// =============================================================================
// State Validation
// =============================================================================

/**
 * Impossible state combinations that should never occur.
 *
 * These are documented here for reference and tested at runtime.
 */
export const IMPOSSIBLE_STATES = [
	{ connection: "disconnected", activity: "streaming" },
	{ connection: "disconnected", activity: "thinking" },
	{ connection: "connecting", activity: "streaming" },
	{ connection: "connecting", activity: "thinking" },
	{ connection: "error", activity: "streaming" },
	{ connection: "error", activity: "thinking" },
] as const;

/**
 * Validate that a session state is not an impossible combination.
 *
 * Returns true if valid, false if impossible.
 */
export function isValidSessionState(state: SessionState): boolean {
	const { connection, activity } = state;

	// When not connected, can only be idle
	if (connection !== "connected") {
		return activity.kind === "idle" || activity.kind === "paused";
	}

	return true;
}

/**
 * Assert that a session state is valid.
 *
 * Throws an error if the state is impossible.
 */
export function assertValidSessionState(state: SessionState): void {
	if (!isValidSessionState(state)) {
		throw new Error(
			`Invalid session state: connection=${state.connection}, activity=${state.activity.kind}`
		);
	}
}

// =============================================================================
// Singleton Pools for Common States
// =============================================================================

/**
 * Frozen singleton objects for common activity states.
 *
 * Reusing these avoids allocating new objects on every `deriveSessionState`
 * call for the predominant cases (idle, thinking, paused). At 50+ sessions
 * streaming at 60fps this reduces object allocation pressure significantly.
 */
const IDLE_ACTIVITY: ActivityState = Object.freeze({ kind: "idle" }) as ActivityState;
const THINKING_ACTIVITY: ActivityState = Object.freeze({ kind: "thinking" }) as ActivityState;
const PAUSED_ACTIVITY: ActivityState = Object.freeze({ kind: "paused" }) as ActivityState;

/** Frozen singleton for the common "no pending input" case. */
const NO_PENDING_INPUT: PendingInput = Object.freeze({ kind: "none" }) as PendingInput;

/** Frozen singletons for attention metadata. */
const DEFAULT_ATTENTION: AttentionMeta = Object.freeze({ hasUnseenCompletion: false });
const UNSEEN_ATTENTION: AttentionMeta = Object.freeze({ hasUnseenCompletion: true });

// =============================================================================
// State Derivation from XState Machine
// =============================================================================

/**
 * XState connection state values (matches ConnectionState enum).
 */
type XStateConnectionState =
	| "disconnected"
	| "connecting"
	| "warmingUp"
	| "ready"
	| "awaitingResponse"
	| "streaming"
	| "paused"
	| "error";

/**
 * Map SessionStatus (from SessionHotState) to XState connection state.
 *
 * This bridges the gap between the simple status enum and the
 * more detailed XState machine states.
 */
export function statusToConnectionState(
	status: "idle" | "loading" | "connecting" | "streaming" | "paused" | "error" | "ready"
): XStateConnectionState {
	switch (status) {
		case "idle":
			return "disconnected";
		case "loading":
		case "connecting":
			return "connecting";
		case "streaming":
			return "streaming";
		case "paused":
			return "paused";
		case "error":
			return "error";
		default:
			return "ready";
	}
}

/**
 * Input for deriving SessionState from various sources.
 */
export interface DeriveSessionStateInput {
	/** XState connection state */
	connectionState: XStateConnectionState;
	/** Current mode ID (e.g., "plan", "code") */
	modeId: string | null;
	/** Current streaming tool call */
	tool: ToolCall | null;
	/** Pending question request */
	pendingQuestion: QuestionRequest | null;
	/** Pending permission request */
	pendingPermission: PermissionRequest | null;
	/** Whether there's an unseen completion */
	hasUnseenCompletion: boolean;
}

/**
 * Derive SessionState from XState machine state and other inputs.
 *
 * This is the single function that computes the canonical session state
 * from the various sources of truth.
 */
export function deriveSessionState(input: DeriveSessionStateInput): SessionState {
	const { connectionState, modeId, tool, pendingQuestion, pendingPermission, hasUnseenCompletion } =
		input;

	// Layer 1: Connection phase
	const connection: ConnectionPhase =
		connectionState === "disconnected"
			? "disconnected"
			: connectionState === "connecting" || connectionState === "warmingUp"
				? "connecting"
				: connectionState === "error"
					? "error"
					: "connected";

	// Layer 2: Activity state — reuse singletons for common cases
	let activity: ActivityState;
	switch (connectionState) {
		case "awaitingResponse":
			activity = THINKING_ACTIVITY;
			break;
		case "streaming":
			activity = { kind: "streaming", modeId, tool };
			break;
		case "paused":
			activity = PAUSED_ACTIVITY;
			break;
		default:
			activity = IDLE_ACTIVITY;
	}

	// Layer 3: Pending input (question takes precedence over permission)
	let pendingInput: PendingInput;
	if (pendingQuestion) {
		pendingInput = { kind: "question", request: pendingQuestion };
	} else if (pendingPermission) {
		pendingInput = { kind: "permission", request: pendingPermission };
	} else {
		pendingInput = NO_PENDING_INPUT;
	}

	// Layer 4: Attention metadata — reuse singletons for common cases
	const attention: AttentionMeta = hasUnseenCompletion ? UNSEEN_ATTENTION : DEFAULT_ATTENTION;

	return { connection, activity, pendingInput, attention };
}
