import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
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
				return okAsync({
					code: 0,
					stdout: "",
					stderr: "",
				});
			}
			return okAsync({
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

		const result = await observeApp({
			appIdentifier: "9223",
			level: "summary",
			runner,
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().composer).toEqual({
			present: true,
			text: "hello",
			sendEnabled: true,
		});
		expect(result._unsafeUnwrap().refs).toEqual([
			{
				ref: "ref-0",
				role: "button",
				name: "Send",
				selector: "button",
			},
		]);
	});
});
