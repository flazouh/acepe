import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCloseSession = vi.fn();
const mockNewSession = vi.fn();
const mockSendPrompt = vi.fn();
const mockSetModel = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribeById = vi.fn();

vi.mock("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("$lib/acp/logic/event-subscriber.js", () => ({
	EventSubscriber: class {
		subscribe(handler: unknown) {
			return mockSubscribe(handler);
		}

		unsubscribeById(listenerId: string): void {
			mockUnsubscribeById(listenerId);
		}
	},
}));

vi.mock("$lib/utils/tauri-client.js", () => ({
	openFileInEditor: vi.fn(),
	revealInFinder: vi.fn(),
	tauriClient: {
		acp: {
			closeSession: (...args: Parameters<typeof mockCloseSession>) => mockCloseSession(...args),
			newSession: (...args: Parameters<typeof mockNewSession>) => mockNewSession(...args),
			sendPrompt: (...args: Parameters<typeof mockSendPrompt>) => mockSendPrompt(...args),
			setModel: (...args: Parameters<typeof mockSetModel>) => mockSetModel(...args),
		},
	},
}));

import { generateShipContentStreaming } from "./ship-card-generation.js";

describe("generateShipContentStreaming", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCloseSession.mockReturnValue(Effect.succeed(undefined));
		mockNewSession.mockReturnValue(Effect.succeed({ sessionId: "ephemeral-1" }));
		mockSendPrompt.mockReturnValue(Effect.succeed(undefined));
		mockSetModel.mockReturnValue(Effect.succeed(undefined));
		mockSubscribe.mockReturnValue(Effect.succeed("listener-1"));
	});

	it("closes the hidden session if model setup fails", async () => {
		mockSetModel.mockReturnValue(Effect.fail(new Error("unsupported model")));

		const result = await Effect.runPromise(
			Effect.result(
				generateShipContentStreaming("prompt", "/repo", vi.fn(), "agent-id", "bad-model")
			)
		);

		expect(Result.isFailure(result)).toBe(true);
		expect(mockCloseSession).toHaveBeenCalledWith("ephemeral-1");
		expect(mockSubscribe).not.toHaveBeenCalled();
		expect(mockSendPrompt).not.toHaveBeenCalled();
	});
});
