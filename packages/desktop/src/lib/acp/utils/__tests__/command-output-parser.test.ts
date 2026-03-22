import { describe, expect, it } from "bun:test";

import { hasCommandOutput, parseCommandOutput } from "../command-output-parser.js";

describe("command-output-parser", () => {
	describe("hasCommandOutput", () => {
		it("returns true when text contains local-command-stdout tag", () => {
			const text = "<local-command-stdout>Set model to Default</local-command-stdout>";
			expect(hasCommandOutput(text)).toBe(true);
		});

		it("returns true when text contains command-name tag", () => {
			const text = "<command-name>/model</command-name>";
			expect(hasCommandOutput(text)).toBe(true);
		});

		it("returns false for plain text", () => {
			expect(hasCommandOutput("Hello world")).toBe(false);
		});

		it("returns false for empty string", () => {
			expect(hasCommandOutput("")).toBe(false);
		});
	});

	describe("parseCommandOutput", () => {
		it("parses complete command output with all tags", () => {
			const text =
				"<command-name>/model</command-name> <command-message>model</command-message> <command-args></command-args> <local-command-stdout>Set model to Default (Opus 4.5)</local-command-stdout>";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("command_output");
			if (result[0].type === "command_output") {
				expect(result[0].content.command).toBe("/model");
				expect(result[0].content.message).toBe("model");
				expect(result[0].content.stdout).toBe("Set model to Default (Opus 4.5)");
			}
		});

		it("parses standalone local-command-stdout tag", () => {
			const text =
				"<local-command-stdout>Set model to [1mDefault (Opus 4.5 · Most capable for complex work)[22m</local-command-stdout>";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("command_output");
			if (result[0].type === "command_output") {
				expect(result[0].content.stdout).toContain("Set model to");
			}
		});

		it("parses standalone command-name/message/args tags", () => {
			const text =
				"<command-name>/model</command-name> <command-message>model</command-message> <command-args></command-args>";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("command_output");
			if (result[0].type === "command_output") {
				expect(result[0].content.command).toBe("/model");
				expect(result[0].content.message).toBe("model");
			}
		});

		it("handles text before and after command output", () => {
			const text =
				"Some text before <local-command-stdout>output</local-command-stdout> some text after";

			const result = parseCommandOutput(text);

			expect(result.length).toBeGreaterThanOrEqual(1);
			// Should have at least the command output
			const commandOutput = result.find((r) => r.type === "command_output");
			expect(commandOutput).toBeDefined();
		});

		it("returns text segment for plain text", () => {
			const text = "Just plain text";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("text");
			if (result[0].type === "text") {
				expect(result[0].content).toBe("Just plain text");
			}
		});

		it("handles ANSI codes in stdout", () => {
			const text =
				"<local-command-stdout>Set model to [1msonnet (claude-sonnet-4-5-20250929)[22m</local-command-stdout>";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("command_output");
			if (result[0].type === "command_output") {
				// ANSI codes should be preserved (stripping happens in the card component)
				expect(result[0].content.stdout).toContain("[1m");
			}
		});

		it("handles newlines in command output", () => {
			const text =
				"<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>";

			const result = parseCommandOutput(text);

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe("command_output");
		});
	});
});
