import { describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

const getEventBridgeInfoInvoke = mock(() =>
	Effect.succeed({
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

		const firstInfo = await Effect.runPromise(Effect.result(first));
		const secondInfo = await Effect.runPromise(Effect.result(second));
		const thirdInfo = await Effect.runPromise(Effect.result(acp.getEventBridgeInfo()));

		expect(Result.isSuccess(firstInfo)).toBe(true);
		expect(Result.isSuccess(secondInfo)).toBe(true);
		expect(Result.isSuccess(thirdInfo)).toBe(true);
		expect(Result.getOrThrow(firstInfo).eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(Result.getOrThrow(secondInfo).eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(Result.getOrThrow(thirdInfo).eventsUrl).toBe("http://127.0.0.1:1234/events");
		expect(getEventBridgeInfoInvoke).toHaveBeenCalledTimes(1);
	});
});
