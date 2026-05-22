import { describe, expect, it } from "bun:test";

import type { CommandOutput } from "../../utils/command-output-parser.js";

import {
	buildCommandOutputCardState,
	getDisplayModel,
	parseCommandModelInfo,
	stripAnsiCodes,
} from "./command-output-card-state.js";

function makeOutput(overrides: Partial<CommandOutput> = {}): CommandOutput {
	return {
		command: "",
		message: "",
		args: "",
		stdout: "",
		...overrides,
	};
}

describe("command-output-card-state", () => {
	it("strips ansi color codes from stdout", () => {
		expect(stripAnsiCodes("\u001b[32mhello\u001b[0m")).toBe("hello");
	});

	it("parses model info with a description", () => {
		expect(parseCommandModelInfo("Set model to Default (Opus 4.5 · Most capable)")).toEqual({
			name: "Default",
			description: "Opus 4.5 · Most capable",
		});
	});

	it("parses simple model info", () => {
		expect(parseCommandModelInfo("Set model to sonnet")).toEqual({
			name: "sonnet",
			description: null,
		});
	});

	it("maps known model names and hides raw claude ids", () => {
		expect(getDisplayModel({ name: "sonnet", description: "claude-sonnet-4-5" })).toEqual({
			name: "Sonnet 4.5",
			description: null,
		});
	});

	it("extracts default model version and description", () => {
		expect(getDisplayModel({ name: "Default", description: "Opus 4.5 · Most capable" })).toEqual({
			name: "Opus 4.5",
			description: "Most capable",
		});
	});

	it("builds model command state from stdout content", () => {
		const state = buildCommandOutputCardState(
			makeOutput({ stdout: "Set model to haiku (claude-haiku-4-5)" })
		);

		expect(state.isModelCommand).toBe(true);
		expect(state.modelInfo).toEqual({ name: "haiku", description: "claude-haiku-4-5" });
		expect(state.displayModel).toEqual({ name: "Haiku 4.5", description: null });
	});

	it("detects model command by command fields", () => {
		const state = buildCommandOutputCardState(makeOutput({ command: "/model" }));

		expect(state.isModelCommand).toBe(true);
		expect(state.modelInfo).toBeNull();
	});

	it("builds generic command output state", () => {
		const state = buildCommandOutputCardState(makeOutput({ stdout: "\u001b[31mdone\u001b[0m" }));

		expect(state.isModelCommand).toBe(false);
		expect(state.modelInfo).toBeNull();
		expect(state.cleanStdout).toBe("done");
	});
});
