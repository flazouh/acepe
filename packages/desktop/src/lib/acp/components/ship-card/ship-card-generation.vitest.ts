import { errAsync, okAsync } from "neverthrow";
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
		mockCloseSession.mockReturnValue(okAsync(undefined));
		mockNewSession.mockReturnValue(okAsync({ sessionId: "ephemeral-1" }));
		mockSendPrompt.mockReturnValue(okAsync(undefined));
		mockSetModel.mockReturnValue(okAsync(undefined));
		mockSubscribe.mockReturnValue(okAsync("listener-1"));
	});

	it("closes the hidden session if model setup fails", async () => {
		mockSetModel.mockReturnValue(errAsync(new Error("unsupported model")));

		const result = await generateShipContentStreaming(
			"prompt",
			"/repo",
			vi.fn(),
			"agent-id",
			"bad-model"
		);

		expect(result.isErr()).toBe(true);
		expect(mockCloseSession).toHaveBeenCalledWith("ephemeral-1");
		expect(mockSubscribe).not.toHaveBeenCalled();
		expect(mockSendPrompt).not.toHaveBeenCalled();
	});
});
