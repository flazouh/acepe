import { describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

const sendMock = mock(() => okAsync(undefined));

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
		const result = await sendNativeNotification({
			title: "Task Complete",
			body: "Agent finished work",
		});

		expect(result.isOk()).toBe(true);
		expect(sendMock).toHaveBeenCalledWith({
			title: "Task Complete",
			body: "Agent finished work",
		});
	});
});
