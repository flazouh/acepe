import { describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

const getEventBridgeInfoInvoke = mock(() =>
	okAsync({
		eventsUrl: "http://127.0.0.1:1234/events",
	})
);

mock.module("../../services/tauri-command-client.js", () => ({
	TAURI_COMMAND_CLIENT: {
		acp: {
			get_event_bridge_info: {
				invoke: getEventBridgeInfoInvoke,
			},
		},
	},
}));

const acpModulePath = "./acp.js?event-bridge-info-cache-test" as string;
const { acp } = (await import(acpModulePath)) as typeof import("./acp.js");

describe("acp tauri client", () => {
	it("shares the event bridge info command across concurrent and later callers", async () => {
		const first = acp.getEventBridgeInfo();
		const second = acp.getEventBridgeInfo();

		const firstInfo = await first;
		const secondInfo = await second;
		const thirdInfo = await acp.getEventBridgeInfo();

		expect(firstInfo.isOk()).toBe(true);
		expect(secondInfo.isOk()).toBe(true);
		expect(thirdInfo.isOk()).toBe(true);
		expect(firstInfo._unsafeUnwrap().eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(secondInfo._unsafeUnwrap().eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(thirdInfo._unsafeUnwrap().eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(getEventBridgeInfoInvoke).toHaveBeenCalledTimes(1);
	});
});
