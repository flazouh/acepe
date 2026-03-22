/**
 * Stream Entry Handler Tests
 *
 * Tests for handleStreamEntry state machine transitions.
 * Verifies that RESPONSE_STARTED is sent correctly for different entry types.
 *
 * Key behavior: "Thinking_" indicator should ONLY show when:
 * - Message sent, agent NOT yet responding (AWAITING_RESPONSE state)
 *
 * It should be hidden when:
 * - Agent IS responding (STREAMING state) - any entry type triggers this
 * - Agent has finished (READY state)
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createActor } from "xstate";
import {
	ConnectionEvent,
	ConnectionState,
	ContentEvent,
	type SessionMachineSnapshot,
	sessionMachine,
} from "../../logic/session-machine";
import { deriveSessionUIState } from "../../logic/session-ui-state";
import type { SessionEntry } from "../types";

/**
 * Helper to create a session entry for testing.
 */
function createAssistantEntry(chunkCount: number = 1): SessionEntry {
	return {
		id: "entry-1",
		type: "assistant",
		message: {
			chunks: Array(chunkCount).fill({
				type: "message" as const,
				block: { type: "text" as const, text: "Hello" },
			}),
		},
		timestamp: new Date(),
	};
}

function createToolCallEntry(): SessionEntry {
	return {
		id: "entry-2",
		type: "tool_call",
		message: {
			id: "tool-1",
			name: "read_file",
			arguments: { kind: "read" as const, file_path: "/test.txt" },
			status: "pending" as const,
			awaitingPlanApproval: false,
		},
		timestamp: new Date(),
	};
}

function createAskEntry(): SessionEntry {
	return {
		id: "entry-3",
		type: "ask",
		message: {
			id: "ask-1",
			question: "What should I do?",
			options: [
				{ id: "yes", label: "Yes" },
				{ id: "no", label: "No" },
			],
		},
		timestamp: new Date(),
	};
}

/**
 * Simulates handleStreamEntry logic.
 * This mirrors the logic in session-store.svelte.ts handleStreamEntry method.
 * Transitions on ANY entry type when in awaitingResponse state.
 */
function simulateHandleStreamEntry(
	machine: ReturnType<typeof createActor<typeof sessionMachine>>,

	_entry: SessionEntry
): void {
	const state = machine.getSnapshot().value as SessionMachineSnapshot;

	// Transition for any entry when awaiting response
	if (state.connection === "awaitingResponse") {
		machine.send({ type: ConnectionEvent.RESPONSE_STARTED });
	}
}

describe("handleStreamEntry State Transitions", () => {
	let machine: ReturnType<typeof createActor<typeof sessionMachine>>;

	beforeEach(() => {
		machine = createActor(sessionMachine, { input: { sessionId: "test-session" } });
		machine.start();

		// Set up machine to be in awaitingResponse state
		machine.send({ type: ContentEvent.LOAD });
		machine.send({ type: ContentEvent.LOADED });
		machine.send({ type: ConnectionEvent.CONNECT });
		machine.send({ type: ConnectionEvent.SUCCESS });
		machine.send({ type: ConnectionEvent.CAPABILITIES_LOADED });
		machine.send({ type: ConnectionEvent.SEND_MESSAGE });

		// Verify we're in awaitingResponse state
		const state = machine.getSnapshot().value as SessionMachineSnapshot;
		expect(state.connection).toBe(ConnectionState.AWAITING_RESPONSE);

		// Verify Thinking_ is shown in this state
		const uiState = deriveSessionUIState(state);
		expect(uiState.showThinking).toBe(true);
	});

	describe("Transition to streaming", () => {
		it("should transition to streaming on first assistant chunk", () => {
			const entry = createAssistantEntry(1);
			simulateHandleStreamEntry(machine, entry);

			const state = machine.getSnapshot().value as SessionMachineSnapshot;
			expect(state.connection).toBe(ConnectionState.STREAMING);

			const uiState = deriveSessionUIState(state);
			expect(uiState.showThinking).toBe(false);
		});

		it("should transition to streaming on tool_call entry", () => {
			const entry = createToolCallEntry();
			simulateHandleStreamEntry(machine, entry);

			const state = machine.getSnapshot().value as SessionMachineSnapshot;
			expect(state.connection).toBe(ConnectionState.STREAMING);

			const uiState = deriveSessionUIState(state);
			expect(uiState.showThinking).toBe(false);
		});

		it("should transition to streaming on ask entry", () => {
			const entry = createAskEntry();
			simulateHandleStreamEntry(machine, entry);

			const state = machine.getSnapshot().value as SessionMachineSnapshot;
			expect(state.connection).toBe(ConnectionState.STREAMING);

			const uiState = deriveSessionUIState(state);
			expect(uiState.showThinking).toBe(false);
		});
	});

	describe("Already streaming", () => {
		it("should NOT re-transition if already streaming", () => {
			// First entry transitions to streaming
			const entry1 = createToolCallEntry();
			simulateHandleStreamEntry(machine, entry1);

			expect((machine.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);

			// Second entry should not cause issues (already streaming)
			const entry2 = createAssistantEntry(1);
			simulateHandleStreamEntry(machine, entry2);

			// Should still be streaming
			expect((machine.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);

			const uiState = deriveSessionUIState(machine.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(false);
		});

		it("should handle multiple entries without transitioning away from streaming", () => {
			// Transition to streaming
			simulateHandleStreamEntry(machine, createToolCallEntry());

			// Send multiple entries
			simulateHandleStreamEntry(machine, createAssistantEntry(1));
			simulateHandleStreamEntry(machine, createAssistantEntry(2));
			simulateHandleStreamEntry(machine, createToolCallEntry());
			simulateHandleStreamEntry(machine, createAskEntry());

			// Should still be streaming after all entries
			expect((machine.getSnapshot().value as SessionMachineSnapshot).connection).toBe(
				ConnectionState.STREAMING
			);
		});
	});

	describe("Thinking_ indicator behavior", () => {
		it("should show Thinking_ ONLY in awaitingResponse state", () => {
			// Before any entry - should show Thinking_
			const uiStateBefore = deriveSessionUIState(
				machine.getSnapshot().value as SessionMachineSnapshot
			);
			expect(uiStateBefore.showThinking).toBe(true);

			// After entry - should hide Thinking_
			simulateHandleStreamEntry(machine, createAssistantEntry());
			const uiStateAfter = deriveSessionUIState(
				machine.getSnapshot().value as SessionMachineSnapshot
			);
			expect(uiStateAfter.showThinking).toBe(false);
		});

		it("should hide Thinking_ when agent sends tool_call as first response", () => {
			// Agent starts by calling a tool (common for Claude Code)
			simulateHandleStreamEntry(machine, createToolCallEntry());

			const uiState = deriveSessionUIState(machine.getSnapshot().value as SessionMachineSnapshot);
			expect(uiState.showThinking).toBe(false);
		});

		it("should hide Thinking_ when response is complete", () => {
			// Transition to streaming
			simulateHandleStreamEntry(machine, createAssistantEntry());

			// Complete the response
			machine.send({ type: ConnectionEvent.RESPONSE_COMPLETE });

			const state = machine.getSnapshot().value as SessionMachineSnapshot;
			expect(state.connection).toBe(ConnectionState.READY);

			const uiState = deriveSessionUIState(state);
			expect(uiState.showThinking).toBe(false);
		});
	});
});
