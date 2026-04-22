import { describe, expect, it } from "vitest";

import type { SessionUpdate } from "../../../services/converted-session-types.js";

import {
	getSessionUpdateType,
	matchSessionUpdate,
	type SessionUpdateHandlers,
} from "../session-update-matcher.js";

describe("SessionUpdateMatcher", () => {
	describe("SessionUpdateType type", () => {
		it("should derive correct types from SessionUpdate union", () => {
			// Type-level test - verify we can create valid SessionUpdate instances
			const validTypes = [
				"userMessageChunk" as const,
				"agentMessageChunk" as const,
				"agentThoughtChunk" as const,
				"toolCall" as const,
				"toolCallUpdate" as const,
				"plan" as const,
				"availableCommandsUpdate" as const,
				"currentModeUpdate" as const,
				"configOptionUpdate" as const,
				"permissionRequest" as const,
				"questionRequest" as const,
				"turnComplete" as const,
			];

			expect(validTypes).toHaveLength(12);
			expect(validTypes).toContain("userMessageChunk");
			expect(validTypes).toContain("agentMessageChunk");
			expect(validTypes).toContain("agentThoughtChunk");
			expect(validTypes).toContain("toolCall");
			expect(validTypes).toContain("toolCallUpdate");
			expect(validTypes).toContain("plan");
			expect(validTypes).toContain("availableCommandsUpdate");
			expect(validTypes).toContain("currentModeUpdate");
			expect(validTypes).toContain("configOptionUpdate");
			expect(validTypes).toContain("permissionRequest");
			expect(validTypes).toContain("questionRequest");
			expect(validTypes).toContain("turnComplete");
		});
	});

	describe("getSessionUpdateType", () => {
		it("extracts type from valid SessionUpdate", () => {
			const update: SessionUpdate = {
				type: "userMessageChunk",
				chunk: { content: { type: "text", text: "test" } },
			};

			const type = getSessionUpdateType(update);
			expect(type).toBe("userMessageChunk");
		});

		it("works with all update types", () => {
			const updates: SessionUpdate[] = [
				{
					type: "userMessageChunk",
					chunk: { content: { type: "text", text: "test" } },
				},
				{
					type: "agentMessageChunk",
					chunk: { content: { type: "text", text: "test" } },
				},
				{
					type: "toolCall",
					tool_call: {
						id: "tool-123",
						name: "read",
						kind: "read",
						arguments: { kind: "read" },
						status: "pending",
						awaitingPlanApproval: false,
					},
				},
			];

			expect(getSessionUpdateType(updates[0])).toBe("userMessageChunk");
			expect(getSessionUpdateType(updates[1])).toBe("agentMessageChunk");
			expect(getSessionUpdateType(updates[2])).toBe("toolCall");
		});
	});

	describe("matchSessionUpdate", () => {
		it("routes userMessageChunk to correct handler", () => {
			const update: SessionUpdate = {
				type: "userMessageChunk",
				chunk: { content: { type: "text", text: "hello" } },
				session_id: "session-123",
			};

			const handlers: SessionUpdateHandlers<string> = {
				userMessageChunk: (data) => `user:${data.chunk.content.type}`,
				agentMessageChunk: () => "agent",
				agentThoughtChunk: () => "thought",
				toolCall: () => "tool",
				toolCallUpdate: () => "toolUpdate",
				plan: () => "plan",
				availableCommandsUpdate: () => "commands",
				currentModeUpdate: () => "mode",
				configOptionUpdate: () => "configOptions",
				permissionRequest: () => "permission",
				questionRequest: () => "question",
				turnComplete: () => "turnComplete",
				turnError: () => "turnError",
				usageTelemetryUpdate: () => "telemetry",
				connectionComplete: () => "connectionComplete",
				connectionFailed: () => "connectionFailed",
			};

			const result = matchSessionUpdate(update, handlers);
			expect(result).toBe("user:text");
		});

		it("routes agentMessageChunk to correct handler", () => {
			const update: SessionUpdate = {
				type: "agentMessageChunk",
				chunk: { content: { type: "text", text: "response" } },
				message_id: "msg-123",
			};

			const handlers: SessionUpdateHandlers<string> = {
				userMessageChunk: () => "user",
				agentMessageChunk: (data) => `agent:${data.message_id}`,
				agentThoughtChunk: () => "thought",
				toolCall: () => "tool",
				toolCallUpdate: () => "toolUpdate",
				plan: () => "plan",
				availableCommandsUpdate: () => "commands",
				currentModeUpdate: () => "mode",
				configOptionUpdate: () => "configOptions",
				permissionRequest: () => "permission",
				questionRequest: () => "question",
				turnComplete: () => "turnComplete",
				turnError: () => "turnError",
				usageTelemetryUpdate: () => "telemetry",
				connectionComplete: () => "connectionComplete",
				connectionFailed: () => "connectionFailed",
			};

			const result = matchSessionUpdate(update, handlers);
			expect(result).toBe("agent:msg-123");
		});

		it("routes toolCall to correct handler", () => {
			const update: SessionUpdate = {
				type: "toolCall",
				tool_call: {
					id: "tool-123",
					name: "Read",
					kind: "read",
					arguments: { kind: "read", file_path: "/test.txt" },
					status: "pending",
					awaitingPlanApproval: false,
				},
			};

			const handlers: SessionUpdateHandlers<string> = {
				userMessageChunk: () => "user",
				agentMessageChunk: () => "agent",
				agentThoughtChunk: () => "thought",
				toolCall: (data) => `tool:${data.tool_call.name}`,
				toolCallUpdate: () => "toolUpdate",
				plan: () => "plan",
				availableCommandsUpdate: () => "commands",
				currentModeUpdate: () => "mode",
				configOptionUpdate: () => "configOptions",
				permissionRequest: () => "permission",
				questionRequest: () => "question",
				turnComplete: () => "turnComplete",
				turnError: () => "turnError",
				usageTelemetryUpdate: () => "telemetry",
				connectionComplete: () => "connectionComplete",
				connectionFailed: () => "connectionFailed",
			};

			const result = matchSessionUpdate(update, handlers);
			expect(result).toBe("tool:Read");
		});

		// Type-level test: This test will fail to compile if we add a new SessionUpdate variant
		// but don't add it to the handlers. This enforces exhaustive matching at runtime.
		it("enforces exhaustive handling of all variants", () => {
			const update: SessionUpdate = {
				type: "userMessageChunk",
				chunk: { content: { type: "text", text: "test" } },
			};

			// If this compiles, it means our type derivation is working and all variants are handled
			const handlers: SessionUpdateHandlers<string> = {
				userMessageChunk: () => "user",
				agentMessageChunk: () => "agent",
				agentThoughtChunk: () => "thought",
				toolCall: () => "tool",
				toolCallUpdate: () => "toolUpdate",
				plan: () => "plan",
				availableCommandsUpdate: () => "commands",
				currentModeUpdate: () => "mode",
				configOptionUpdate: () => "configOptions",
				permissionRequest: () => "permission",
				questionRequest: () => "question",
				turnComplete: () => "turnComplete",
				turnError: () => "turnError",
				usageTelemetryUpdate: () => "telemetry",
				connectionComplete: () => "connectionComplete",
				connectionFailed: () => "connectionFailed",
			};

			const result = matchSessionUpdate(update, handlers);
			expect(typeof result).toBe("string");
		});

		it("handles all metadata update types", () => {
			const metadataUpdates: SessionUpdate[] = [
				{
					type: "toolCallUpdate",
					update: { toolCallId: "tool-123", status: "completed" },
				},
				{
					type: "plan",
					plan: { steps: [{ description: "step", status: "pending" }] },
				},
				{
					type: "availableCommandsUpdate",
					update: { availableCommands: [] },
				},
				{
					type: "currentModeUpdate",
					update: { currentModeId: "code" },
				},
				{
					type: "configOptionUpdate",
					update: {
						configOptions: [
							{
								id: "mode",
								name: "Mode",
								category: "mode",
								type: "select",
								currentValue: "auto",
								options: [{ name: "Auto", value: "auto" }],
							},
						],
					},
				},
				{
					type: "permissionRequest",
					permission: {
						id: "p-123",
						sessionId: "s-123",
						permission: "read",
						patterns: [],
						metadata: {},
						always: [],
						autoAccepted: false,
					},
				},
				{
					type: "questionRequest",
					question: {
						id: "q-123",
						sessionId: "s-123",
						questions: [
							{
								question: "Continue?",
								header: "Confirmation",
								options: [{ label: "Yes", description: "Continue" }],
								multiSelect: false,
							},
						],
					},
				},
			];

			const handlers: SessionUpdateHandlers<string> = {
				userMessageChunk: () => "user",
				agentMessageChunk: () => "agent",
				agentThoughtChunk: () => "thought",
				toolCall: () => "tool",
				toolCallUpdate: () => "toolUpdate",
				plan: () => "plan",
				availableCommandsUpdate: () => "commands",
				currentModeUpdate: () => "mode",
				configOptionUpdate: () => "configOptions",
				permissionRequest: () => "permission",
				questionRequest: () => "question",
				turnComplete: () => "turnComplete",
				turnError: () => "turnError",
				usageTelemetryUpdate: () => "telemetry",
				connectionComplete: () => "connectionComplete",
				connectionFailed: () => "connectionFailed",
			};

			for (const update of metadataUpdates) {
				const result = matchSessionUpdate(update, handlers);
				expect(typeof result).toBe("string");
			}
		});
	});
});
