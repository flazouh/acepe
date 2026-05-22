import { describe, expect, it } from "bun:test";

import type { UserMessage } from "../../types/user-message.js";

import { buildUserMessageDisplayState, processUserMessageChunks } from "./user-message-state.js";

function makeMessage(chunks: UserMessage["chunks"]): UserMessage {
	return {
		content: chunks[0] ?? { type: "text", text: "" },
		chunks,
	};
}

describe("user-message-state", () => {
	it("keeps normal text chunks and drops blank text chunks", () => {
		const chunks = processUserMessageChunks([
			{ type: "text", text: "hello" },
			{ type: "text", text: "   " },
		]);

		expect(chunks).toEqual([{ type: "text", text: "hello" }]);
	});

	it("keeps non-text chunks as blocks", () => {
		const chunks = processUserMessageChunks([
			{ type: "image", data: "abc", mimeType: "image/png" },
		]);

		expect(chunks).toEqual([
			{ type: "block", block: { type: "image", data: "abc", mimeType: "image/png" } },
		]);
	});

	it("splits command output tags into display chunks", () => {
		const state = buildUserMessageDisplayState(
			makeMessage([
				{
					type: "text",
					text: `before
<command-name>/model</command-name>
<command-message>model</command-message>
<command-args>opus</command-args>
<local-command-stdout>Set model to opus</local-command-stdout>
after`,
				},
			])
		);

		expect(state.isOnlyCommandOutput).toBe(false);
		expect(state.processedChunks).toEqual([
			{ type: "text", text: "before" },
			{
				type: "command_output",
				output: {
					command: "/model",
					message: "model",
					args: "opus",
					stdout: "Set model to opus",
				},
			},
			{ type: "text", text: "after" },
		]);
	});

	it("detects messages that are only command output", () => {
		const state = buildUserMessageDisplayState(
			makeMessage([
				{
					type: "text",
					text: `<local-command-stdout>done</local-command-stdout>`,
				},
			])
		);

		expect(state.isOnlyCommandOutput).toBe(true);
		expect(state.processedChunks).toEqual([
			{
				type: "command_output",
				output: {
					command: "",
					message: "",
					args: "",
					stdout: "done",
				},
			},
		]);
	});

	it("does not treat an empty processed message as only command output", () => {
		const state = buildUserMessageDisplayState(makeMessage([{ type: "text", text: "" }]));

		expect(state.isOnlyCommandOutput).toBe(false);
		expect(state.processedChunks).toEqual([]);
	});
});
