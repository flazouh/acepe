/**
 * Session Machine Tests
 *
 * Tests parallel state transitions in both content and connection regions.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import {
	ConnectionEvent,
	ConnectionState,
	ContentEvent,
	ContentState,
	type SessionMachineContext,
	type SessionMachineSnapshot,
	sessionMachine,
} from "../session-machine";
import { deriveSessionRuntimeState, deriveSessionUIState } from "../session-ui-state";

describe("Session Machine", () => {
	describe("Parallel State Progression", () => {
		it("should start in unloaded/disconnected state", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			expect(state.content).toBe(ContentState.UNLOADED);
			expect(state.connection).toBe(ConnectionState.DISCONNECTED);
		});

		it("should allow content loading and connection in parallel", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			// Dispatch both events simultaneously
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ConnectionEvent.CONNECT });

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			expect(state.content).toBe(ContentState.LOADING);
			expect(state.connection).toBe(ConnectionState.CONNECTING);
		});

		it("should complete content loading while connection continues", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			// Start both regions
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ConnectionEvent.CONNECT });

			// Complete content loading while connection continues
			actor.send({ type: ContentEvent.LOADED });

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			expect(state.content).toBe(ContentState.LOADED);
			expect(state.connection).toBe(ConnectionState.CONNECTING);
		});

		it("should complete connection while content continues loading", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			// Start both regions
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ConnectionEvent.CONNECT });

			// Complete connection while content continues
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			expect(state.content).toBe(ContentState.LOADING);
			expect(state.connection).toBe(ConnectionState.READY);
		});
	});

	describe("Content Region Transitions", () => {
		it("should transition through content loading states", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.UNLOADED
			);

			actor.send({ type: ContentEvent.LOAD });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.LOADING
			);

			actor.send({ type: ContentEvent.LOADED });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.LOADED
			);
		});

		it("should handle content loading errors and retries", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			actor.send({ type: ContentEvent.LOAD });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.LOADING
			);

			actor.send({ type: ContentEvent.LOAD_ERROR });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.ERROR
			);

			actor.send({ type: ContentEvent.RETRY });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).content).toBe(
				ContentState.LOADING
			);
		});
	});

	describe("Connection Region Transitions", () => {
		it("should transition through full connection lifecycle", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.DISCONNECTED
			);

			actor.send({ type: ConnectionEvent.CONNECT });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.CONNECTING
			);

			actor.send({ type: ConnectionEvent.SUCCESS });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.WARMING_UP
			);

			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.READY
			);

			actor.send({ type: ConnectionEvent.SEND_MESSAGE });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.AWAITING_RESPONSE
			);

			actor.send({ type: ConnectionEvent.RESPONSE_STARTED });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);

			actor.send({ type: ConnectionEvent.RESPONSE_COMPLETE });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.READY
			);
		});

		it("should handle connection errors and retries", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			actor.send({ type: ConnectionEvent.CONNECT });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.CONNECTING
			);

			actor.send({ type: ConnectionEvent.ERROR });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.ERROR
			);

			actor.send({ type: ConnectionEvent.RETRY });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.CONNECTING
			);
		});

		it("should handle pause/resume during streaming", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			// Get to streaming state
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });
			actor.send({ type: ConnectionEvent.RESPONSE_STARTED });

			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);

			actor.send({ type: ConnectionEvent.PAUSE });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.PAUSED
			);

			actor.send({ type: ConnectionEvent.RESUME });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);

			actor.send({ type: ConnectionEvent.RESPONSE_COMPLETE });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.READY
			);
		});

		it("should handle disconnect from ready state", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "test" } });
			actor.start();

			// Disconnect from ready state
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.READY
			);

			actor.send({ type: ConnectionEvent.DISCONNECT });
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.DISCONNECTED
			);
		});
	});

	describe("UI State Derivation", () => {
		it("should NOT show thinking when loading content", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADING,
				connection: ConnectionState.DISCONNECTED,
			});
			expect(uiState.showThinking).toBe(false);
			expect(uiState.showContentLoading).toBe(true);
		});

		it("should show thinking ONLY when awaiting response", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.AWAITING_RESPONSE,
			});
			expect(uiState.showThinking).toBe(true);
		});

		it("should show both content loading and connecting simultaneously", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADING,
				connection: ConnectionState.CONNECTING,
			});
			expect(uiState.showContentLoading).toBe(true);
			expect(uiState.showConnecting).toBe(true);
			expect(uiState.showThinking).toBe(false);
		});

		it("should show conversation when content is loaded", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.READY,
			});
			expect(uiState.showConversation).toBe(true);
			expect(uiState.inputEnabled).toBe(true);
			expect(uiState.showThinking).toBe(false);
		});

		it("should show ready placeholder when connected but no content", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.UNLOADED,
				connection: ConnectionState.READY,
			});
			expect(uiState.showReady).toBe(true);
			expect(uiState.showConversation).toBe(false);
			expect(uiState.inputEnabled).toBe(true);
		});

		it("should show error state from either region", () => {
			// Content error
			let uiState = deriveSessionUIState({
				content: ContentState.ERROR,
				connection: ConnectionState.READY,
			});
			expect(uiState.showError).toBe(true);

			// Connection error
			uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.ERROR,
			});
			expect(uiState.showError).toBe(true);
		});

		it("should be read-only when disconnected", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.DISCONNECTED,
			});
			expect(uiState.isReadOnly).toBe(true);
			expect(uiState.inputEnabled).toBe(false);
		});

		it("should show streaming when in STREAMING state", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.STREAMING,
			});
			expect(uiState.showStreaming).toBe(true);
			expect(uiState.showThinking).toBe(false);
		});

		it("should NOT show streaming when awaiting response", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.AWAITING_RESPONSE,
			});
			expect(uiState.showStreaming).toBe(false);
			expect(uiState.showThinking).toBe(true);
		});

		it("should NOT show streaming when ready", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.READY,
			});
			expect(uiState.showStreaming).toBe(false);
			expect(uiState.showThinking).toBe(false);
		});

		it("should NOT show streaming when paused", () => {
			const uiState = deriveSessionUIState({
				content: ContentState.LOADED,
				connection: ConnectionState.PAUSED,
			});
			expect(uiState.showStreaming).toBe(false);
		});
	});

	describe("Runtime State Derivation", () => {
		it("should allow stop/cancel while awaiting or running", () => {
			const waiting = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.AWAITING_RESPONSE,
			});
			expect(waiting.showStop).toBe(true);
			expect(waiting.canCancel).toBe(true);
			expect(waiting.activityPhase).toBe("waiting_for_user");

			const running = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.STREAMING,
			});
			expect(running.showStop).toBe(true);
			expect(running.canCancel).toBe(true);
			expect(running.activityPhase).toBe("running");
		});

		it("should suppress blocking connecting overlay once content is loaded", () => {
			const runtime = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.CONNECTING,
			});
			expect(runtime.showConnectingOverlay).toBe(false);
		});

		it("should allow submit from ready state and settled disconnected history", () => {
			const ready = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.READY,
			});
			expect(ready.canSubmit).toBe(true);

			const historical = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.DISCONNECTED,
			});
			expect(historical.canSubmit).toBe(true);

			const connecting = deriveSessionRuntimeState({
				content: ContentState.LOADED,
				connection: ConnectionState.CONNECTING,
			});
			expect(connecting.canSubmit).toBe(false);
		});
	});

	describe("Machine Context", () => {
		it("should store modes and models on SESSION_CREATED", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "test" },
			});
			actor.start();

			const modes = [{ id: "plan", name: "Plan" }];
			const models = [{ id: "opus", name: "Opus" }];

			actor.send({
				type: "SESSION_CREATED",
				modes,
				models,
				currentModeId: "plan",
				currentModelId: "opus",
			});

			const context = actor.getSnapshot().context as SessionMachineContext;
			expect(context.modes).toEqual(modes);
			expect(context.models).toEqual(models);
			expect(context.currentModeId).toBe("plan");
			expect(context.currentModelId).toBe("opus");
		});

		it("should store error message on connection error", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "test" },
			});
			actor.start();

			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({
				type: ConnectionEvent.ERROR,
				error: "Connection refused",
			});

			const context = actor.getSnapshot().context as SessionMachineContext;
			expect(context.connectionError).toBe("Connection refused");
		});

		it("should clear error on successful retry", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "test" },
			});
			actor.start();

			// Get to error state
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.ERROR, error: "Failed" });
			expect((actor.getSnapshot().context as SessionMachineContext).connectionError).toBe("Failed");

			// Retry and succeed
			actor.send({ type: ConnectionEvent.RETRY });
			actor.send({ type: ConnectionEvent.SUCCESS });

			expect((actor.getSnapshot().context as SessionMachineContext).connectionError).toBeNull();
		});

		it("should initialize context with default values", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "test-session-123" },
			});
			actor.start();

			const context = actor.getSnapshot().context as SessionMachineContext;
			expect(context.sessionId).toBe("test-session-123");
			expect(context.modes).toEqual([]);
			expect(context.models).toEqual([]);
			expect(context.currentModeId).toBeNull();
			expect(context.currentModelId).toBeNull();
			expect(context.connectionError).toBeNull();
			expect(context.turnFailure).toBeNull();
			expect(context.contentError).toBeNull();
		});
	});

	describe("SESSION_CREATED Event", () => {
		it("should transition from DISCONNECTED to READY on SESSION_CREATED", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "new-session" },
			});
			actor.start();

			// Initial state
			expect((actor.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.DISCONNECTED
			);

			// Create session
			actor.send({
				type: "SESSION_CREATED",
				modes: [{ id: "build", name: "Build" }],
				models: [{ id: "sonnet", name: "Sonnet" }],
				currentModeId: "build",
				currentModelId: "sonnet",
			});

			// Should be READY immediately (new sessions don't need warmup)
			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			expect(state.connection).toBe(ConnectionState.READY);
			expect(state.content).toBe(ContentState.LOADED); // New session = empty but loaded
		});

		it("should derive correct UI state after SESSION_CREATED", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "new-session" },
			});
			actor.start();

			actor.send({
				type: "SESSION_CREATED",
				modes: [],
				models: [],
				currentModeId: null,
				currentModelId: null,
			});

			const uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.inputEnabled).toBe(true); // THE BUG FIX
			expect(uiState.showReady).toBe(false); // Content is LOADED, not UNLOADED
			expect(uiState.showConversation).toBe(true); // Empty conversation, but loaded
		});
	});

	describe("Real-world Scenarios", () => {
		it("should handle historical session loading (THE BUG FIX)", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "historical" } });
			actor.start();

			// User clicks historical session - BOTH regions start in parallel
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ConnectionEvent.CONNECT });

			// Verify UI state: NO thinking, but loading content and connecting
			const uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(false); // THE FIX!
			expect(uiState.showContentLoading).toBe(true);
			expect(uiState.showConnecting).toBe(true);

			// Content loads first
			actor.send({ type: ContentEvent.LOADED });

			// UI should now show conversation, still connecting
			const uiState2 = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState2.showConversation).toBe(true);
			expect(uiState2.showConnecting).toBe(true);
			expect(uiState2.showThinking).toBe(false);

			// Connection completes
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			// UI should now be fully ready
			const uiState3 = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState3.showConversation).toBe(true);
			expect(uiState3.inputEnabled).toBe(true);
			expect(uiState3.showConnecting).toBe(false);
			expect(uiState3.showThinking).toBe(false);
		});

		it("should handle message sending flow", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "active" } });
			actor.start();

			// Start with loaded content and ready connection
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			// Send message
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });

			// Should show thinking (awaiting response)
			const uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(true);
			expect(uiState.showConversation).toBe(true);

			// Response starts
			actor.send({ type: ConnectionEvent.RESPONSE_STARTED });

			// Should stop showing thinking, start showing streaming (for typewriter animation)
			const uiState2 = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState2.showThinking).toBe(false);
			expect(uiState2.showStreaming).toBe(true);

			// Response completes - streaming should stop
			actor.send({ type: ConnectionEvent.RESPONSE_COMPLETE });

			const uiState3 = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState3.showStreaming).toBe(false);
			expect(uiState3.showThinking).toBe(false);
		});

		it("should clear thinking when a turn completes before streaming starts", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "turn-error" } });
			actor.start();

			// Setup: loaded content + ready connection
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			// User sends message, session enters awaiting response
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });
			const waitingUiState = deriveSessionUIState(
				actor.getSnapshot().value as SessionMachineSnapshot
			);
			expect(waitingUiState.showThinking).toBe(true);
			expect(actor.getSnapshot().value.connection).toBe(ConnectionState.AWAITING_RESPONSE);

			// Turn completes without RESPONSE_STARTED (e.g. immediate turn error)
			actor.send({ type: ConnectionEvent.RESPONSE_COMPLETE });
			const uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);

			expect(actor.getSnapshot().value.connection).toBe(ConnectionState.READY);
			expect(uiState.showThinking).toBe(false);
			expect(uiState.showStreaming).toBe(false);
		});

		it("should recover to ready on recoverable turn failure", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "turn-failure-recoverable" },
			});
			actor.start();

			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });

			actor.send({
				type: ConnectionEvent.TURN_FAILED,
				failure: {
					turnId: "turn-1",
					message: "Rate limit reached",
					code: null,
					kind: "recoverable",
					source: "unknown",
				},
			});

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			const uiState = deriveSessionUIState(state);
			const context = actor.getSnapshot().context as SessionMachineContext;
			expect(state.connection).toBe(ConnectionState.READY);
			expect(uiState.showThinking).toBe(false);
			expect(uiState.showStreaming).toBe(false);
			expect(uiState.showError).toBe(false);
			expect(context.connectionError).toBeNull();
			expect(context.turnFailure).toEqual({
				turnId: "turn-1",
				message: "Rate limit reached",
				code: null,
				kind: "recoverable",
				source: "unknown",
			});
		});

		it("should transition to error on fatal turn failure", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "turn-failure-fatal" } });
			actor.start();

			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });

			actor.send({
				type: ConnectionEvent.TURN_FAILED,
				failure: {
					turnId: "turn-2",
					message: "Process transport is not ready",
					code: null,
					kind: "fatal",
					source: "process",
				},
			});

			const state = actor.getSnapshot().value as SessionMachineSnapshot;
			const uiState = deriveSessionUIState(state);
			expect(state.connection).toBe(ConnectionState.ERROR);
			expect(uiState.showThinking).toBe(false);
			expect(uiState.showStreaming).toBe(false);
			expect(uiState.showError).toBe(true);
		});

		it("clears stored turn failure when a new turn starts", () => {
			const actor = createActor(sessionMachine, {
				input: { sessionId: "turn-failure-reset" },
			});
			actor.start();

			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });
			actor.send({
				type: ConnectionEvent.TURN_FAILED,
				failure: {
					turnId: "turn-1",
					message: "Rate limit reached",
					code: null,
					kind: "recoverable",
					source: "unknown",
				},
			});

			expect((actor.getSnapshot().context as SessionMachineContext).turnFailure).not.toBeNull();

			actor.send({ type: ConnectionEvent.SEND_MESSAGE });

			expect((actor.getSnapshot().context as SessionMachineContext).turnFailure).toBeNull();
		});

		it("should show streaming state for typewriter animation (THE TYPEWRITER FIX)", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "typewriter" } });
			actor.start();

			// Setup: Get to ready state with loaded content
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ContentEvent.LOADED });
			actor.send({ type: ConnectionEvent.CONNECT });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			// User sends message - should show thinking (before response)
			actor.send({ type: ConnectionEvent.SEND_MESSAGE });
			let uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(true);
			expect(uiState.showStreaming).toBe(false);

			// Agent starts responding - should switch to streaming (for typewriter animation)
			actor.send({ type: ConnectionEvent.RESPONSE_STARTED });
			uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(false);
			expect(uiState.showStreaming).toBe(true);

			// Agent pauses - should not be streaming
			actor.send({ type: ConnectionEvent.PAUSE });
			uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showStreaming).toBe(false);

			// Agent resumes - should be streaming again
			actor.send({ type: ConnectionEvent.RESUME });
			uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showStreaming).toBe(true);

			// Response completes - no more streaming
			actor.send({ type: ConnectionEvent.RESPONSE_COMPLETE });
			uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showStreaming).toBe(false);
			expect(uiState.showThinking).toBe(false);
		});

		it("should handle parallel region errors independently", () => {
			const actor = createActor(sessionMachine, { input: { sessionId: "error-test" } });
			actor.start();

			// Start both regions
			actor.send({ type: ContentEvent.LOAD });
			actor.send({ type: ConnectionEvent.CONNECT });

			// Content fails, connection succeeds
			actor.send({ type: ContentEvent.LOAD_ERROR });
			actor.send({ type: ConnectionEvent.SUCCESS });
			actor.send({ type: ConnectionEvent.CAPABILITIES_LOADED });

			const uiState = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showError).toBe(true); // Content error
			expect(uiState.inputEnabled).toBe(true); // Connection ready
			expect(uiState.showConversation).toBe(false); // No content

			// Retry content loading
			actor.send({ type: ContentEvent.RETRY });

			const uiState2 = deriveSessionUIState(actor.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState2.showError).toBe(false); // Content retrying
			expect(uiState2.showContentLoading).toBe(true);
			expect(uiState2.inputEnabled).toBe(true); // Connection still ready
		});
	});
});
