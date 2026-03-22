/**
 * Shared test factories for creating mock SessionEntry instances.
 *
 * Used across agent-panel logic tests to avoid duplicating entry creation helpers.
 */

import type { SessionEntry } from "../../../../application/dto/session.js";

export function createUserEntry(id: string): SessionEntry {
	return {
		id,
		type: "user",
		message: {
			content: { type: "text", text: `User message ${id}` },
			chunks: [{ type: "text", text: `User message ${id}` }],
			sentAt: new Date(),
		},
		timestamp: new Date(),
	};
}

export function createAssistantEntry(id: string): SessionEntry {
	return {
		id,
		type: "assistant",
		message: {
			chunks: [
				{
					type: "message" as const,
					block: { type: "text" as const, text: `Assistant response ${id}` },
				},
			],
		},
		timestamp: new Date(),
	};
}

export function createToolCallEntry(id: string): SessionEntry {
	return {
		id,
		type: "tool_call",
		message: {
			id,
			name: "test_tool",
			status: "completed" as const,
			arguments: { kind: "other" as const, raw: {} },
			awaitingPlanApproval: false,
		},
		timestamp: new Date(),
	};
}
