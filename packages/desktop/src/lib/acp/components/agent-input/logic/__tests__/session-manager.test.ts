import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { Session } from "../../../../application/dto/session.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { MessageSendError, SessionCreationError } from "../../errors/agent-input-error.js";
import { type CreateSessionOptions, createSession, sendMessage } from "../session-manager.js";

async function runToResult<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
	return Effect.runPromise(Effect.result(effect));
}

describe("createSession", () => {
	it("should create session with provided options", async () => {
		const createSessionMock = mock(() => {
			const session: Session = {
				id: "session-123",
				projectPath: "/test",
				agentId: "claude-code",
				title: "Test Project",
				status: "idle",
				entries: [],
				entryCount: 0,
				isConnected: false,
				isStreaming: false,
				availableModes: [],
				availableModels: [],
				availableCommands: [],
				currentMode: null,
				currentModel: null,
				taskProgress: null,
				acpSessionId: null,
				updatedAt: new Date(),
				createdAt: new Date(),
				parentId: null,
			};
			return Effect.succeed({ kind: "ready" as const, session });
		});
		const mockStore = {
			connection: {
				createSession: createSessionMock,
			},
		} as unknown as SessionStore;

		const options: CreateSessionOptions = {
			agentId: "claude-code",
			initialAutonomousEnabled: true,
			projectPath: "/test",
			projectName: "Test Project",
			title: "Build kanban parity",
		};

		const result = await runToResult(createSession(mockStore, options));
		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toEqual({
				sessionId: "session-123",
				deferredCreation: false,
			});
		}
		expect(createSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "claude-code",
				initialAutonomousEnabled: true,
				projectPath: "/test",
				title: "Build kanban parity",
			})
		);
	});

	it("should return SessionCreationError when store.connection.createSession fails", async () => {
		const mockStore = {
			connection: {
				createSession: mock(() => {
					return Effect.fail(new Error("Store error"));
				}),
			},
		} as unknown as SessionStore;

		const options: CreateSessionOptions = {
			agentId: "claude-code",
			projectPath: "/test",
			projectName: "Test Project",
		};

		const result = await runToResult(createSession(mockStore, options));
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(SessionCreationError);
			expect(result.failure.agentId).toBe("claude-code");
			expect(result.failure.projectPath).toBe("/test");
		}
	});
});

describe("sendMessage", () => {
	it("should send message successfully", async () => {
		const sendMessageMock = mock(() => Effect.succeed(undefined));
		const mockStore = {
			connection: {
				sendMessage: sendMessageMock,
			},
		} as unknown as SessionStore;

		const result = await runToResult(sendMessage(mockStore, "session-123", "Hello"));
		expect(Result.isSuccess(result)).toBe(true);
		expect(sendMessageMock).toHaveBeenCalledWith("session-123", "Hello", []);
	});

	it("should return MessageSendError when store.connection.sendMessage fails", async () => {
		const mockStore = {
			connection: {
				sendMessage: mock(() => {
					return Effect.fail(new Error("Send error"));
				}),
			},
		} as unknown as SessionStore;

		const result = await runToResult(sendMessage(mockStore, "session-123", "Hello"));
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toBeInstanceOf(MessageSendError);
			expect(result.failure.sessionId).toBe("session-123");
			expect(result.failure.message).toBe("Hello");
		}
	});

	it("should handle empty message", async () => {
		const sendMessageMock = mock(() => Effect.succeed(undefined));
		const mockStore = {
			connection: {
				sendMessage: sendMessageMock,
			},
		} as unknown as SessionStore;

		const result = await runToResult(sendMessage(mockStore, "session-123", ""));
		expect(Result.isSuccess(result)).toBe(true);
		expect(sendMessageMock).toHaveBeenCalledWith("session-123", "", []);
	});
});
