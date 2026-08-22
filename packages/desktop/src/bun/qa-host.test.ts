import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { QA_RESULT_MESSAGE_ID } from "electrobun-qa";

import { attachQaHost, keepQaHost, qaWindowPreload } from "./qa-host.ts";

test("unsigned build injects the QA preload script", () => {
	expect(qaWindowPreload(true, "window.__electrobunQa = {};")).toBe("window.__electrobunQa = {};");
});

test("signed build drops the QA preload", () => {
	expect(qaWindowPreload(false, "window.__electrobunQa = {};")).toBeNull();
});

test("signed attach leaves the host unstarted and does not bind qa:result", async () => {
	const message: Record<string, (payload: unknown) => void> = {};
	const result = await Effect.runPromise(
		Effect.scoped(
			attachQaHost({
				signed: true,
				path: "/tmp/electrobun-qa/desktop-signed.sock",
				title: "Acepe",
				url: "views://mainview/index.html",
				sender: {
					executeJavascript: () => undefined,
				},
				message,
			})
		)
	);
	expect(result.started).toBe(false);
	expect(result.path).toBeNull();
	expect(message[QA_RESULT_MESSAGE_ID]).toBeUndefined();
});

test("unsigned attach starts the host and binds qa:result", async () => {
	const message: Record<string, (payload: unknown) => void> = {};
	const path = "/tmp/electrobun-qa/desktop-unsigned.sock";
	const result = await Effect.runPromise(
		Effect.scoped(
			attachQaHost({
				signed: false,
				path,
				title: "Acepe",
				url: "views://mainview/index.html",
				sender: {
					executeJavascript: () => undefined,
				},
				message,
			})
		)
	);
	expect(result.started).toBe(true);
	expect(result.path).toBe(path);
	expect(typeof message[QA_RESULT_MESSAGE_ID]).toBe("function");
});

test("signed keepQaHost completes without starting a socket", async () => {
	const message: Record<string, (payload: unknown) => void> = {};
	const result = await Effect.runPromise(
		Effect.scoped(
			keepQaHost({
				signed: true,
				path: "/tmp/electrobun-qa/desktop-keep-signed.sock",
				title: "Acepe",
				url: "views://mainview/index.html",
				sender: {
					executeJavascript: () => undefined,
				},
				message,
			})
		)
	);
	expect(result.started).toBe(false);
	expect(message[QA_RESULT_MESSAGE_ID]).toBeUndefined();
});
