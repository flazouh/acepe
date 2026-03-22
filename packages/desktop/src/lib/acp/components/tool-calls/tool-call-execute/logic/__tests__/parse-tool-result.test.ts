import { describe, expect, it } from "bun:test";

import { parseToolResultOutput, parseToolResultWithExitCode } from "../parse-tool-result.js";

describe("parseToolResultOutput", () => {
	it("should return plain string result", () => {
		const result = parseToolResultOutput("Hello, world!");

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Hello, world!");
		}
	});

	it("should parse JSON-stringified string result", () => {
		const jsonString = JSON.stringify("Parsed string");
		const result = parseToolResultOutput(jsonString);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Parsed string");
		}
	});

	it("should extract output from object with output field", () => {
		const result = parseToolResultOutput({ output: "Command output" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Command output");
		}
	});

	it("should extract stdout from object with stdout field", () => {
		const result = parseToolResultOutput({ stdout: "Standard output" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Standard output");
		}
	});

	it("should extract stderr from object with stderr field", () => {
		const result = parseToolResultOutput({ stderr: "Error output" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Error output");
		}
	});

	it("should prioritize output over stdout and stderr", () => {
		const result = parseToolResultOutput({
			output: "Output",
			stdout: "Stdout",
			stderr: "Stderr",
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Output");
		}
	});

	it("should prioritize stdout over stderr when output is missing", () => {
		const result = parseToolResultOutput({
			stdout: "Stdout",
			stderr: "Stderr",
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Stdout");
		}
	});

	it("should parse nested JSON-stringified output in object", () => {
		const nestedOutput = JSON.stringify("Nested string");
		const result = parseToolResultOutput({ output: nestedOutput });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("Nested string");
		}
	});

	it("should return original string if JSON parsing fails", () => {
		const invalidJson = "not valid json {";
		const result = parseToolResultOutput(invalidJson);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe(invalidJson);
		}
	});

	it("should return null for null input", () => {
		const result = parseToolResultOutput(null);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBeNull();
		}
	});

	it("should return null for undefined input", () => {
		const result = parseToolResultOutput(undefined);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBeNull();
		}
	});

	it("should return null for empty string", () => {
		const result = parseToolResultOutput("");

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("");
		}
	});

	it("should return null for object with no output fields", () => {
		const result = parseToolResultOutput({ other: "value" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBeNull();
		}
	});

	it("should return null for empty object", () => {
		const result = parseToolResultOutput({});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBeNull();
		}
	});

	it("should handle object with all empty output fields", () => {
		const result = parseToolResultOutput({
			output: "",
			stdout: "",
			stderr: "",
		});

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("");
		}
	});

	it("should handle JSON-stringified object that contains a string", () => {
		const jsonString = JSON.stringify({ data: "test" });
		const result = parseToolResultOutput(jsonString);

		// JSON-stringified object should return as-is (not a string result)
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			// The schema will match it as a string, so it returns the JSON string
			// Then the logic should try to parse it
			expect(typeof result.value).toBe("string");
		}
	});

	it("should handle complex nested JSON in output field", () => {
		const complexOutput = JSON.stringify({ nested: { value: "test" } });
		const result = parseToolResultOutput({ output: complexOutput });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			// Should return the JSON string, then try to parse it
			expect(result.value).toBe(complexOutput);
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

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value).toBe("1:# Acepe");
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
});
