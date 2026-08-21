import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

const sendMock = mock(() => Effect.succeed(undefined));

mock.module("$lib/utils/tauri-client/notifications.js", () => ({
	notifications: {
		send: sendMock,
		getPermission: mock(),
		requestPermission: mock(),
	},
}));

import { sendNativeNotification } from "./native-notification.js";

describe("native-notification", () => {
	it("routes notification delivery through the Tauri plugin invoke command", async () => {
		const result = await Effect.runPromise(
			Effect.result(
				sendNativeNotification({
					title: "Task Complete",
					body: "Agent finished work",
				})
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(sendMock).toHaveBeenCalledWith({
			title: "Task Complete",
			body: "Agent finished work",
		});
	});
});
