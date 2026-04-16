/**
 * Session State Machine using XState with Parallel Regions
 *
 * Manages two independent state regions:
 * - Content: Entry loading from disk
 * - Connection: ACP connection lifecycle
 *
 * This allows content loading and connection establishment to happen simultaneously.
 */

import { assign, setup } from "xstate";
import type { Mode } from "../application/dto/mode.js";
import type { Model } from "../application/dto/model.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";

// ============================================
// CONTENT REGION STATES
// ============================================

/**
 * Content region states - entry loading from disk.
 */
export enum ContentState {
	UNLOADED = "unloaded",
	LOADING = "loading",
	LOADED = "loaded",
	ERROR = "error",
}

/**
 * Content region events.
 */
export enum ContentEvent {
	LOAD = "CONTENT_LOAD",
	LOADED = "CONTENT_LOADED",
	LOAD_ERROR = "CONTENT_LOAD_ERROR",
	RETRY = "CONTENT_RETRY",
}

// ============================================
// CONNECTION REGION STATES
// ============================================

/**
 * Connection region states - ACP connection lifecycle.
 */
export enum ConnectionState {
	DISCONNECTED = "disconnected",
	CONNECTING = "connecting",
	WARMING_UP = "warmingUp",
	READY = "ready",
	AWAITING_RESPONSE = "awaitingResponse",
	STREAMING = "streaming",
	PAUSED = "paused",
	ERROR = "error",
}

/**
 * Connection region events.
 */
export enum ConnectionEvent {
	CONNECT = "CONNECTION_CONNECT",
	SUCCESS = "CONNECTION_SUCCESS",
	CAPABILITIES_LOADED = "CONNECTION_CAPABILITIES_LOADED",
	ERROR = "CONNECTION_ERROR",
	TURN_FAILED = "CONNECTION_TURN_FAILED",
	DISCONNECT = "CONNECTION_DISCONNECT",
	SEND_MESSAGE = "CONNECTION_SEND_MESSAGE",
	RESPONSE_STARTED = "CONNECTION_RESPONSE_STARTED",
	RESPONSE_COMPLETE = "CONNECTION_RESPONSE_COMPLETE",
	PAUSE = "CONNECTION_PAUSE",
	RESUME = "CONNECTION_RESUME",
	RETRY = "CONNECTION_RETRY",
}

// ============================================
// STATE MACHINE DEFINITION
// ============================================

/**
 * Session state machine with parallel regions.
 *
 * Content and connection regions progress independently:
 * - Content: unloaded → loading → loaded | error
 * - Connection: disconnected → connecting → warmingUp → ready → awaitingResponse → streaming | paused | error
 */
export const sessionMachine = setup({
	types: {
		context: {} as SessionMachineContext,
		input: {} as SessionMachineInput,
		events: {} as
			| { type: typeof ContentEvent.LOAD }
			| { type: typeof ContentEvent.LOADED }
			| { type: typeof ContentEvent.LOAD_ERROR }
			| { type: typeof ContentEvent.RETRY }
			| { type: typeof ConnectionEvent.CONNECT }
			| { type: typeof ConnectionEvent.SUCCESS }
			| { type: typeof ConnectionEvent.CAPABILITIES_LOADED }
			| ConnectionErrorEvent
			| TurnFailureEvent
			| { type: typeof ConnectionEvent.DISCONNECT }
			| { type: typeof ConnectionEvent.SEND_MESSAGE }
			| { type: typeof ConnectionEvent.RESPONSE_STARTED }
			| { type: typeof ConnectionEvent.RESPONSE_COMPLETE }
			| { type: typeof ConnectionEvent.PAUSE }
			| { type: typeof ConnectionEvent.RESUME }
			| { type: typeof ConnectionEvent.RETRY }
			| SessionCreatedEvent,
	},
	actions: {
		storeSessionData: assign({
			modes: ({ event }) => (event as SessionCreatedEvent).modes,
			models: ({ event }) => (event as SessionCreatedEvent).models,
			currentModeId: ({ event }) => (event as SessionCreatedEvent).currentModeId,
			currentModelId: ({ event }) => (event as SessionCreatedEvent).currentModelId,
		}),
		storeConnectionError: assign({
			connectionError: ({ event }) => (event as ConnectionErrorEvent).error ?? "Unknown error",
		}),
		storeTurnFailure: assign({
			turnFailure: ({ event }) => (event as TurnFailureEvent).failure,
		}),
		clearConnectionError: assign({
			connectionError: () => null,
		}),
		clearTurnFailure: assign({
			turnFailure: () => null,
		}),
	},
}).createMachine({
	id: "session",
	type: "parallel",
	context: ({ input }) => ({
		sessionId: input.sessionId,
		modes: [],
		models: [],
		currentModeId: null,
		currentModelId: null,
		connectionError: null,
		turnFailure: null,
		contentError: null,
	}),
	states: {
		content: {
			initial: ContentState.UNLOADED,
			states: {
				[ContentState.UNLOADED]: {
					on: {
						[ContentEvent.LOAD]: ContentState.LOADING,
						// New sessions start with empty but loaded content
						SESSION_CREATED: ContentState.LOADED,
					},
				},
				[ContentState.LOADING]: {
					on: {
						[ContentEvent.LOADED]: ContentState.LOADED,
						[ContentEvent.LOAD_ERROR]: ContentState.ERROR,
					},
				},
				[ContentState.LOADED]: {},
				[ContentState.ERROR]: {
					on: { [ContentEvent.RETRY]: ContentState.LOADING },
				},
			},
		},
		connection: {
			initial: ConnectionState.DISCONNECTED,
			states: {
				[ConnectionState.DISCONNECTED]: {
					on: {
						[ConnectionEvent.CONNECT]: ConnectionState.CONNECTING,
						// Direct transition to READY for new sessions (bypasses CONNECTING → WARMING_UP)
						SESSION_CREATED: {
							target: ConnectionState.READY,
							actions: "storeSessionData",
						},
					},
				},
				[ConnectionState.CONNECTING]: {
					on: {
						[ConnectionEvent.SUCCESS]: {
							target: ConnectionState.WARMING_UP,
							actions: ["clearConnectionError", "clearTurnFailure"],
						},
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
					},
				},
				[ConnectionState.WARMING_UP]: {
					on: {
						[ConnectionEvent.CAPABILITIES_LOADED]: ConnectionState.READY,
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
					},
				},
				[ConnectionState.READY]: {
					on: {
						[ConnectionEvent.SEND_MESSAGE]: {
							target: ConnectionState.AWAITING_RESPONSE,
							actions: "clearTurnFailure",
						},
						[ConnectionEvent.DISCONNECT]: ConnectionState.DISCONNECTED,
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
					},
				},
				[ConnectionState.AWAITING_RESPONSE]: {
					on: {
						[ConnectionEvent.RESPONSE_STARTED]: ConnectionState.STREAMING,
						[ConnectionEvent.RESPONSE_COMPLETE]: {
							target: ConnectionState.READY,
							actions: "clearTurnFailure",
						},
						[ConnectionEvent.TURN_FAILED]: [
							{
								guard: ({ event }) => (event as TurnFailureEvent).failure.kind === "fatal",
								target: ConnectionState.ERROR,
								actions: "storeTurnFailure",
							},
							{
								target: ConnectionState.READY,
								actions: "storeTurnFailure",
							},
						],
						[ConnectionEvent.DISCONNECT]: ConnectionState.DISCONNECTED,
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
					},
				},
				[ConnectionState.STREAMING]: {
					on: {
						[ConnectionEvent.RESPONSE_COMPLETE]: {
							target: ConnectionState.READY,
							actions: "clearTurnFailure",
						},
						[ConnectionEvent.TURN_FAILED]: [
							{
								guard: ({ event }) => (event as TurnFailureEvent).failure.kind === "fatal",
								target: ConnectionState.ERROR,
								actions: "storeTurnFailure",
							},
							{
								target: ConnectionState.READY,
								actions: "storeTurnFailure",
							},
						],
						[ConnectionEvent.PAUSE]: ConnectionState.PAUSED,
						[ConnectionEvent.DISCONNECT]: ConnectionState.DISCONNECTED,
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
					},
				},
				[ConnectionState.PAUSED]: {
					on: {
						[ConnectionEvent.RESUME]: ConnectionState.STREAMING,
						[ConnectionEvent.RESPONSE_COMPLETE]: {
							target: ConnectionState.READY,
							actions: "clearTurnFailure",
						},
						[ConnectionEvent.TURN_FAILED]: [
							{
								guard: ({ event }) => (event as TurnFailureEvent).failure.kind === "fatal",
								target: ConnectionState.ERROR,
								actions: "storeTurnFailure",
							},
							{
								target: ConnectionState.READY,
								actions: "storeTurnFailure",
							},
						],
						[ConnectionEvent.ERROR]: {
							target: ConnectionState.ERROR,
							actions: "storeConnectionError",
						},
						[ConnectionEvent.DISCONNECT]: ConnectionState.DISCONNECTED,
					},
				},
				[ConnectionState.ERROR]: {
					on: {
						[ConnectionEvent.RETRY]: {
							target: ConnectionState.CONNECTING,
							actions: ["clearConnectionError", "clearTurnFailure"],
						},
						[ConnectionEvent.DISCONNECT]: ConnectionState.DISCONNECTED,
					},
				},
			},
		},
	},
});

/**
 * Type for the session machine snapshot.
 */
export type SessionMachineSnapshot = {
	content: ContentState;
	connection: ConnectionState;
};

/**
 * Input for creating a session machine actor.
 */
export interface SessionMachineInput {
	sessionId: string;
}

// ============================================
// MACHINE CONTEXT
// ============================================

/**
 * Session machine context - stores session data.
 */
export interface SessionMachineContext {
	sessionId: string;
	// Capabilities
	modes: Mode[];
	models: Model[];
	currentModeId: string | null;
	currentModelId: string | null;
	// Error state
	connectionError: string | null;
	turnFailure?: ActiveTurnFailure | null;
	contentError: string | null;
}

// ============================================
// EVENT TYPES
// ============================================

/**
 * Event fired when session is created with modes and models.
 */
export type SessionCreatedEvent = {
	type: "SESSION_CREATED";
	modes: Mode[];
	models: Model[];
	currentModeId: string | null;
	currentModelId: string | null;
};

/**
 * Connection error event with optional error message.
 */
export type ConnectionErrorEvent = {
	type: typeof ConnectionEvent.ERROR;
	error?: string;
};

export type TurnFailureEvent = {
	type: typeof ConnectionEvent.TURN_FAILED;
	failure: ActiveTurnFailure;
};

/**
 * Union type of all session machine events.
 */
export type SessionMachineEvent =
	| { type: typeof ContentEvent.LOAD }
	| { type: typeof ContentEvent.LOADED }
	| { type: typeof ContentEvent.LOAD_ERROR }
	| { type: typeof ContentEvent.RETRY }
	| { type: typeof ConnectionEvent.CONNECT }
	| { type: typeof ConnectionEvent.SUCCESS }
	| { type: typeof ConnectionEvent.CAPABILITIES_LOADED }
	| ConnectionErrorEvent
	| TurnFailureEvent
	| { type: typeof ConnectionEvent.DISCONNECT }
	| { type: typeof ConnectionEvent.SEND_MESSAGE }
	| { type: typeof ConnectionEvent.RESPONSE_STARTED }
	| { type: typeof ConnectionEvent.RESPONSE_COMPLETE }
	| { type: typeof ConnectionEvent.PAUSE }
	| { type: typeof ConnectionEvent.RESUME }
	| { type: typeof ConnectionEvent.RETRY }
	| SessionCreatedEvent;
