import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { observeApp } from "../observe";
import type { CommandRunner } from "../tauri-mcp";

function wrapped(text: string): string {
	return JSON.stringify({
		content: [
			{
				text,
			},
		],
	});
}

describe("acepe-qa observe", () => {
	it("normalizes a compact WebView observation", async () => {
		const runner: CommandRunner = (command) => {
			const joined = command.join(" ");
			if (joined.includes("driver-session")) {
				return Effect.succeed({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return Effect.succeed({
				code: 0,
				stdout: wrapped(
					JSON.stringify({
						url: "http://localhost:1420/",
						title: "Acepe",
						route: "/",
						panelCount: 1,
						focusedPanelTitle: "Session 123",
						visibleSessionErrors: [],
						composer: {
							present: true,
							text: "hello",
							sendEnabled: true,
							sessionCanSubmit: null,
						},
						consoleErrors: [],
						refs: [
							{
								ref: "ref-0",
								role: "button",
								name: "Send",
								selector: "button",
							},
						],
						rawTextPreview: "Session 123 hello",
					})
				),
				stderr: "",
			});
		};

		const result = await Effect.runPromise(
			Effect.result(
				observeApp({
					appIdentifier: "9223",
					level: "summary",
					runner,
				})
			)
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(Result.getOrThrow(result).composer).toEqual({
			present: true,
			text: "hello",
			sendEnabled: true,
			sessionCanSubmit: null,
		});
		expect(Result.getOrThrow(result).refs).toEqual([
			{
				ref: "ref-0",
				role: "button",
				name: "Send",
				selector: "button",
			},
		]);
	});
});
