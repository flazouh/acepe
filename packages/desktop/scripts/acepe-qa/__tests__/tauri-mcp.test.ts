import { describe, expect, it } from "bun:test";
import { okAsync } from "neverthrow";
import { z } from "zod";
import {
	type CommandRunner,
	captureWebviewScreenshot,
	executeWebviewJson,
	jsonObjectPrefix,
	unwrapTauriText,
} from "../tauri-mcp";

function wrapped(text: string): string {
	return JSON.stringify({
		content: [
			{
				text,
			},
		],
	});
}

describe("acepe-qa tauri mcp helpers", () => {
	it("unwraps text from tauri mcp content wrappers", () => {
		const result = unwrapTauriText(wrapped('{"ok":true}'));

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe('{"ok":true}');
	});

	it("extracts the first json object from noisy output", () => {
		expect(jsonObjectPrefix('prefix {"ok":true} suffix')).toBe('{"ok":true}');
		expect(jsonObjectPrefix("no json")).toBeNull();
	});

	it("executes webview js and validates schema", async () => {
		const runner: CommandRunner = () =>
			okAsync({
				code: 0,
				stdout: wrapped('{"url":"http://localhost:1420/","title":"Acepe"}'),
				stderr: "",
			});

		const result = await executeWebviewJson(
			{
				appIdentifier: "9223",
				script: "(() => ({}))()",
				schema: z.object({
					url: z.string(),
					title: z.string(),
				}),
			},
			runner
		);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			url: "http://localhost:1420/",
			title: "Acepe",
		});
	});

	it("extracts screenshot file paths from mixed content wrappers", async () => {
		const runner: CommandRunner = () =>
			okAsync({
				code: 0,
				stdout: JSON.stringify({
					text: "Screenshot captured",
					content: [
						{
							type: "text",
							text: "Screenshot captured",
						},
						{
							type: "image",
							mimeType: "image/jpeg",
							path: "/tmp/acepe-shot.jpg",
						},
					],
					files: [
						{
							path: "/tmp/acepe-shot.jpg",
							mimeType: "image/jpeg",
						},
					],
				}),
				stderr: "",
			});

		const result = await captureWebviewScreenshot("9223", runner);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe("/tmp/acepe-shot.jpg");
	});
});
