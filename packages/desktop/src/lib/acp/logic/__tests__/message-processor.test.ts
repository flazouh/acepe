import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "../../../services/converted-session-types.js";

import { MessageProcessor } from "../message-processor.js";

// Mock crypto.randomUUID for deterministic testing
const mockUUID = vi.fn(
	(): `${string}-${string}-${string}-${string}-${string}` => "00000000-0000-0000-0000-000000000000"
);
vi.spyOn(crypto, "randomUUID").mockImplementation(mockUUID);

describe("MessageProcessor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUUID.mockReturnValue("00000000-0000-0000-0000-000000000000");
	});

	describe("constructor", () => {
		it("uses crypto.randomUUID by default", () => {
			const processor = new MessageProcessor();
			expect(processor).toBeInstanceOf(MessageProcessor);
		});

		it("accepts custom ID generator", () => {
			const customIdGen = vi.fn(() => "custom-id");
			// Just verify construction works - processor is used implicitly
			new MessageProcessor(customIdGen);
			expect(customIdGen).not.toHaveBeenCalled(); // Not called until processing
		});
	});

	describe("processUpdate", () => {
		let processor: MessageProcessor;

		beforeEach(() => {
			processor = new MessageProcessor();
		});

		describe("userMessageChunk", () => {
			const update: SessionUpdate = {
				type: "userMessageChunk",
				chunk: {
					content: { type: "text", text: "Hello world" },
				},
				session_id: "session-123",
			};

			it("creates user thread entry", () => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);

				if (result.isOk()) {
					expect(result.value).toEqual({
						id: "00000000-0000-0000-0000-000000000000",
						type: "user",
						message: {
							content: { type: "text", text: "Hello world" },
							chunks: [{ type: "text", text: "Hello world" }],
						},
						timestamp: expect.any(Date),
					});
					expect(result.value?.timestamp).toBeInstanceOf(Date);
				}
			});

			it("uses custom ID generator", () => {
				const customIdGen = vi.fn(() => "custom-user-id");
				const customProcessor = new MessageProcessor(customIdGen);

				const result = customProcessor.processUpdate(update);
				expect(result.isOk()).toBe(true);
				expect(customIdGen).toHaveBeenCalledOnce();
				if (result.isOk()) {
					expect(result.value?.id).toBe("custom-user-id");
				}
			});
		});

		describe("agentMessageChunk", () => {
			const update: SessionUpdate = {
				type: "agentMessageChunk",
				chunk: {
					content: { type: "text", text: "Assistant response" },
				},
				message_id: "msg-456",
				session_id: "session-123",
			};

			it("creates assistant thread entry with message type", () => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);

				if (result.isOk()) {
					expect(result.value).toEqual({
						id: "00000000-0000-0000-0000-000000000000",
						type: "assistant",
						message: {
							chunks: [
								{
									type: "message",
									block: { type: "text", text: "Assistant response" },
								},
							],
						},
						timestamp: expect.any(Date),
					});
					expect(result.value?.timestamp).toBeInstanceOf(Date);
				}
			});
		});

		describe("agentThoughtChunk", () => {
			const update: SessionUpdate = {
				type: "agentThoughtChunk",
				chunk: {
					content: { type: "text", text: "Thinking..." },
				},
				message_id: "msg-789",
				session_id: "session-123",
			};

			it("creates assistant thread entry with thought type", () => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);

				if (result.isOk()) {
					expect(result.value).toEqual({
						id: "00000000-0000-0000-0000-000000000000",
						type: "assistant",
						message: {
							chunks: [
								{
									type: "thought",
									block: { type: "text", text: "Thinking..." },
								},
							],
						},
						timestamp: expect.any(Date),
					});
					expect(result.value?.timestamp).toBeInstanceOf(Date);
				}
			});

			it("strips [Thinking] prefix from thought content", () => {
				const updateWithPrefix: SessionUpdate = {
					type: "agentThoughtChunk",
					chunk: {
						content: { type: "text", text: "[Thinking] I should check the file first." },
					},
					message_id: "msg-789",
					session_id: "session-123",
				};

				const result = processor.processUpdate(updateWithPrefix);
				expect(result.isOk()).toBe(true);

				if (result.isOk() && result.value?.type === "assistant") {
					expect(result.value.message).toEqual({
						chunks: [
							{
								type: "thought",
								block: { type: "text", text: "I should check the file first." },
							},
						],
					});
				}
			});

			it("strips lowercase [thinking] prefix from thought content", () => {
				const updateWithPrefix: SessionUpdate = {
					type: "agentThoughtChunk",
					chunk: {
						content: { type: "text", text: "[thinking] analyzing the request" },
					},
					message_id: "msg-789",
					session_id: "session-123",
				};

				const result = processor.processUpdate(updateWithPrefix);
				expect(result.isOk()).toBe(true);

				if (result.isOk() && result.value && result.value.type === "assistant") {
					expect(result.value.message).toEqual({
						chunks: [
							{
								type: "thought",
								block: { type: "text", text: "analyzing the request" },
							},
						],
					});
				}
			});

			it("detects [Thinking] prefix in message chunks and converts to thought", () => {
				const messageUpdate: SessionUpdate = {
					type: "agentMessageChunk",
					chunk: {
						content: { type: "text", text: "[Thinking] This should become a thought" },
					},
					message_id: "msg-456",
					session_id: "session-123",
				};

				const result = processor.processUpdate(messageUpdate);
				expect(result.isOk()).toBe(true);

				if (result.isOk() && result.value && result.value.type === "assistant") {
					expect(result.value.message).toEqual({
						chunks: [
							{
								type: "thought",
								block: { type: "text", text: "This should become a thought" },
							},
						],
					});
				}
			});

			it("preserves regular message chunks without [Thinking] prefix", () => {
				const messageUpdate: SessionUpdate = {
					type: "agentMessageChunk",
					chunk: {
						content: { type: "text", text: "This is a regular message" },
					},
					message_id: "msg-456",
					session_id: "session-123",
				};

				const result = processor.processUpdate(messageUpdate);
				expect(result.isOk()).toBe(true);

				if (result.isOk() && result.value && result.value.type === "assistant") {
					expect(result.value.message).toEqual({
						chunks: [
							{
								type: "message",
								block: { type: "text", text: "This is a regular message" },
							},
						],
					});
				}
			});
		});

		describe("toolCall", () => {
			const update: SessionUpdate = {
				type: "toolCall",
				tool_call: {
					id: "tool-123",
					name: "read_file",
					kind: "read",
					arguments: { kind: "read", file_path: "/test.txt" },
					status: "pending",
					awaitingPlanApproval: false,
				},
				session_id: "session-123",
			};

			it("creates tool_call thread entry", () => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);

				if (result.isOk()) {
					expect(result.value).toEqual({
						id: "tool-123",
						type: "tool_call",
						toolCall: {
							id: "tool-123",
							name: "read_file",
							kind: "read",
							arguments: { kind: "read", file_path: "/test.txt" },
							status: "pending",
							awaitingPlanApproval: false,
						},
						timestamp: expect.any(Date),
					});
					expect(result.value?.timestamp).toBeInstanceOf(Date);
				}
			});

			it("uses tool call ID instead of generating new one", () => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);
				if (result.isOk()) {
					expect(result.value?.id).toBe("tool-123");
				}
				expect(mockUUID).not.toHaveBeenCalled();
			});
		});

		describe("metadata updates", () => {
			const metadataUpdates: SessionUpdate[] = [
				{
					type: "toolCallUpdate",
					update: {
						toolCallId: "tool-123",
						status: "completed",
						result: "file content",
					},
					session_id: "session-123",
				},
				{
					type: "plan",
					plan: {
						steps: [{ description: "Step 1", status: "pending" }],
						currentStep: 0,
					},
					session_id: "session-123",
				},
				{
					type: "availableCommandsUpdate",
					update: {
						availableCommands: [
							{
								name: "read_file",
								description: "Read a file",
								input: { hint: "file path" },
							},
						],
					},
					session_id: "session-123",
				},
				{
					type: "currentModeUpdate",
					update: { currentModeId: "code" },
					session_id: "session-123",
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
					session_id: "session-123",
				},
				{
					type: "permissionRequest",
					permission: {
						id: "perm-123",
						sessionId: "session-123",
						permission: "read_file",
						patterns: ["/**/*.txt"],
						metadata: {},
						always: [],
					},
					session_id: "session-123",
				},
				{
					type: "questionRequest",
					question: {
						id: "q-123",
						sessionId: "session-123",
						questions: [
							{
								question: "Continue?",
								header: "Confirmation",
								options: [
									{ label: "Yes", description: "Continue" },
									{ label: "No", description: "Stop" },
								],
								multiSelect: false,
							},
						],
					},
					session_id: "session-123",
				},
			];

			it.each(
				metadataUpdates.map((update, index) => [update.type, update, index])
			)("returns null for %s update", (_, update) => {
				const result = processor.processUpdate(update);
				expect(result.isOk()).toBe(true);
				if (result.isOk()) {
					expect(result.value).toBeNull();
				}
			});
		});
	});

	describe("mergeUserMessageChunk", () => {
		let processor: MessageProcessor;

		beforeEach(() => {
			processor = new MessageProcessor();
		});

		it("merges chunk into existing user message", () => {
			const existing: Parameters<MessageProcessor["mergeUserMessageChunk"]>[0] = {
				content: { type: "text", text: "Hello" },
				chunks: [{ type: "text", text: "Hello" }],
			};

			const chunk: Parameters<MessageProcessor["mergeUserMessageChunk"]>[1] = {
				content: { type: "text", text: " world" },
			};

			const result = processor.mergeUserMessageChunk(existing, chunk);

			expect(result).toEqual({
				content: { type: "text", text: "Hello world" },
				chunks: [
					{ type: "text", text: "Hello" },
					{ type: "text", text: " world" },
				],
			});
		});
	});

	describe("mergeAssistantMessageChunk", () => {
		let processor: MessageProcessor;

		beforeEach(() => {
			processor = new MessageProcessor();
		});

		it("merges message chunk into existing assistant message", () => {
			const existing: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[0] = {
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Hello" },
					},
				],
			};

			const chunk: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[1] = {
				content: { type: "text", text: " world" },
			};

			const result = processor.mergeAssistantMessageChunk(existing, chunk, false);

			expect(result).toEqual({
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Hello" },
					},
					{
						type: "message",
						block: { type: "text", text: " world" },
					},
				],
			});
		});

		it("merges thought chunk into existing assistant message", () => {
			const existing: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[0] = {
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Response" },
					},
				],
			};

			const chunk: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[1] = {
				content: { type: "text", text: "Thinking..." },
			};

			const result = processor.mergeAssistantMessageChunk(existing, chunk, true);

			expect(result).toEqual({
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Response" },
					},
					{
						type: "thought",
						block: { type: "text", text: "Thinking..." },
					},
				],
			});
		});

		it("strips [Thinking] prefix when merging thought chunk", () => {
			const existing: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[0] = {
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Response" },
					},
				],
			};

			const chunk: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[1] = {
				content: { type: "text", text: "[Thinking] I need to analyze this." },
			};

			const result = processor.mergeAssistantMessageChunk(existing, chunk, true);

			expect(result).toEqual({
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Response" },
					},
					{
						type: "thought",
						block: { type: "text", text: "I need to analyze this." },
					},
				],
			});
		});

		it("detects [Thinking] prefix in message chunk and converts to thought", () => {
			const existing: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[0] = {
				chunks: [],
			};

			const chunk: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[1] = {
				content: { type: "text", text: "[Thinking] This should become a thought" },
			};

			const result = processor.mergeAssistantMessageChunk(existing, chunk, false);

			expect(result).toEqual({
				chunks: [
					{
						type: "thought",
						block: { type: "text", text: "This should become a thought" },
					},
				],
			});
		});

		it("preserves regular message chunk without [Thinking] prefix", () => {
			const existing: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[0] = {
				chunks: [],
			};

			const chunk: Parameters<MessageProcessor["mergeAssistantMessageChunk"]>[1] = {
				content: { type: "text", text: "Regular message content" },
			};

			const result = processor.mergeAssistantMessageChunk(existing, chunk, false);

			expect(result).toEqual({
				chunks: [
					{
						type: "message",
						block: { type: "text", text: "Regular message content" },
					},
				],
			});
		});
	});
});
