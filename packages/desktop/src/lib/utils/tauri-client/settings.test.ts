import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const requestDestructiveConfirmationTokenInvoke = mock(() => okAsync("confirmation-token-1"));
const resetDatabaseInvoke = mock(() => okAsync(undefined));

mock.module("../../services/tauri-command-client.js", () => ({
	TAURI_COMMAND_CLIENT: {
		storage: {
			request_destructive_confirmation_token: {
				invoke: requestDestructiveConfirmationTokenInvoke,
			},
			reset_database: {
				invoke: resetDatabaseInvoke,
			},
		},
	},
}));

const { settings } = await import("./settings.js");

describe("settings tauri client", () => {
	beforeEach(() => {
		requestDestructiveConfirmationTokenInvoke.mockReset();
		requestDestructiveConfirmationTokenInvoke.mockImplementation(() => okAsync("confirmation-token-1"));
		resetDatabaseInvoke.mockReset();
		resetDatabaseInvoke.mockImplementation(() => okAsync(undefined));
	});

	it("requests a scoped destructive confirmation token before resetting the database", async () => {
		await settings.resetDatabase().match(
			() => undefined,
			(error) => {
				throw error;
			}
		);

		expect(requestDestructiveConfirmationTokenInvoke).toHaveBeenCalledWith({
			operation: "reset_database",
			target: "all-data",
		});
		expect(resetDatabaseInvoke).toHaveBeenCalledWith({
			confirmationToken: "confirmation-token-1",
		});
	});
});
