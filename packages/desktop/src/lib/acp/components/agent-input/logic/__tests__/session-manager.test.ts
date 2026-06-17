import { describe, expect, it, mock } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import type { Session } from "../../../../application/dto/session.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import { MessageSendError, SessionCreationError } from "../../errors/agent-input-error.js";
import { type CreateSessionOptions, createSession, sendMessage } from "../session-manager.js";

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
			return okAsync({ kind: "ready" as const, session });
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

		const result = await createSession(mockStore, options);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toEqual({
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
					return errAsync(new Error("Store error"));
				}),
			},
		} as unknown as SessionStore;

		const options: CreateSessionOptions = {
			agentId: "claude-code",
			projectPath: "/test",
			projectName: "Test Project",
		};

		const result = await createSession(mockStore, options);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(SessionCreationError);
			expect(result.error.agentId).toBe("claude-code");
			expect(result.error.projectPath).toBe("/test");
		}
	});
});

describe("sendMessage", () => {
	it("should send message successfully", async () => {
		const sendMessageMock = mock(() => okAsync(undefined));
		const mockStore = {
			connection: {
				sendMessage: sendMessageMock,
			},
		} as unknown as SessionStore;

		const result = await sendMessage(mockStore, "session-123", "Hello");
		expect(result.isOk()).toBe(true);
		expect(sendMessageMock).toHaveBeenCalledWith("session-123", "Hello", []);
	});

	it("should return MessageSendError when store.connection.sendMessage fails", async () => {
		const mockStore = {
			connection: {
				sendMessage: mock(() => {
					return errAsync(new Error("Send error"));
				}),
			},
		} as unknown as SessionStore;

		const result = await sendMessage(mockStore, "session-123", "Hello");
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(MessageSendError);
			expect(result.error.sessionId).toBe("session-123");
			expect(result.error.message).toBe("Hello");
		}
	});

	it("should handle empty message", async () => {
		const sendMessageMock = mock(() => okAsync(undefined));
		const mockStore = {
			connection: {
				sendMessage: sendMessageMock,
			},
		} as unknown as SessionStore;

		const result = await sendMessage(mockStore, "session-123", "");
		expect(result.isOk()).toBe(true);
		expect(sendMessageMock).toHaveBeenCalledWith("session-123", "", []);
	});
});
