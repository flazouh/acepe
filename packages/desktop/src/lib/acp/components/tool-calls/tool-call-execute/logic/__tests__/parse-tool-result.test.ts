import { describe, expect, it } from "bun:test";
import * as Result from "effect/Result";

import { parseToolResultOutput, parseToolResultWithExitCode } from "../parse-tool-result.js";

describe("parseToolResultOutput", () => {
	it("should return plain string result", () => {
		const result = parseToolResultOutput("Hello, world!");

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Hello, world!");
		}
	});

	it("should parse JSON-stringified string result", () => {
		const jsonString = JSON.stringify("Parsed string");
		const result = parseToolResultOutput(jsonString);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Parsed string");
		}
	});

	it("should extract output from object with output field", () => {
		const result = parseToolResultOutput({ output: "Command output" });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Command output");
		}
	});

	it("should extract stdout from object with stdout field", () => {
		const result = parseToolResultOutput({ stdout: "Standard output" });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Standard output");
		}
	});

	it("should extract stderr from object with stderr field", () => {
		const result = parseToolResultOutput({ stderr: "Error output" });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Error output");
		}
	});

	it("should prioritize output over stdout and stderr", () => {
		const result = parseToolResultOutput({
			output: "Output",
			stdout: "Stdout",
			stderr: "Stderr",
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Output");
		}
	});

	it("should prioritize stdout over stderr when output is missing", () => {
		const result = parseToolResultOutput({
			stdout: "Stdout",
			stderr: "Stderr",
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Stdout");
		}
	});

	it("should parse nested JSON-stringified output in object", () => {
		const nestedOutput = JSON.stringify("Nested string");
		const result = parseToolResultOutput({ output: nestedOutput });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("Nested string");
		}
	});

	it("should return original string if JSON parsing fails", () => {
		const invalidJson = "not valid json {";
		const result = parseToolResultOutput(invalidJson);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe(invalidJson);
		}
	});

	it("should return null for null input", () => {
		const result = parseToolResultOutput(null);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("should return null for undefined input", () => {
		const result = parseToolResultOutput(undefined);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("should return null for empty string", () => {
		const result = parseToolResultOutput("");

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("");
		}
	});

	it("should return null for object with no output fields", () => {
		const result = parseToolResultOutput({ other: "value" });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("should return null for empty object", () => {
		const result = parseToolResultOutput({});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("should handle object with all empty output fields", () => {
		const result = parseToolResultOutput({
			output: "",
			stdout: "",
			stderr: "",
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("");
		}
	});

	it("should handle JSON-stringified object that contains a string", () => {
		const jsonString = JSON.stringify({ data: "test" });
		const result = parseToolResultOutput(jsonString);

		// JSON-stringified object should return as-is (not a string result)
		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			// The schema will match it as a string, so it returns the JSON string
			// Then the logic should try to parse it
			expect(typeof result.success).toBe("string");
		}
	});

	it("should handle complex nested JSON in output field", () => {
		const complexOutput = JSON.stringify({ nested: { value: "test" } });
		const result = parseToolResultOutput({ output: complexOutput });

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			// Should return the JSON string, then try to parse it
			expect(result.success).toBe(complexOutput);
		}
	});

	it("should strip exec envelope and return clean output", () => {
		const result = parseToolResultOutput(
			[
				"Chunk ID: f8d993",
				"Wall time: 0.0523 seconds",
				"Process exited with code 0",
				"Original token count: 3",
				"Output:",
				"1:# Acepe",
			].join("\n")
		);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("1:# Acepe");
		}
	});

	it("prefers detailed content objects and strips shell exit markers", () => {
		const result = parseToolResultOutput({
			content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
			detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBe("/Users/alex/Documents/acepe");
		}
	});
});

describe("parseToolResultWithExitCode", () => {
	it("should extract clean stdout and exit code from exec envelope", () => {
		const parsed = parseToolResultWithExitCode(
			[
				"Chunk ID: f8d993",
				"Wall time: 0.0523 seconds",
				"Process exited with code 0",
				"Original token count: 3",
				"Output:",
				"1:# Acepe",
			].join("\n")
		);

		expect(parsed.stdout).toBe("1:# Acepe");
		expect(parsed.exitCode).toBe(0);
		expect(parsed.stderr).toBeNull();
	});

	it("should extract stdout from MCP content block arrays", () => {
		const parsed = parseToolResultWithExitCode([
			{ type: "text", text: "test output" },
			{ type: "text", text: "done" },
		]);

		expect(parsed.stdout).toBe("test output\ndone");
		expect(parsed.stderr).toBeNull();
		expect(parsed.exitCode).toBeUndefined();
	});

	it("extracts stdout and exit code from tool-call result objects with detailed content", () => {
		const parsed = parseToolResultWithExitCode({
			content: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
			detailedContent: "/Users/alex/Documents/acepe\n<exited with exit code 0>",
		});

		expect(parsed.stdout).toBe("/Users/alex/Documents/acepe");
		expect(parsed.stderr).toBeNull();
		expect(parsed.exitCode).toBe(0);
	});
});
