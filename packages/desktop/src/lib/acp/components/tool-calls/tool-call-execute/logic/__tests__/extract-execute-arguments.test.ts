import { describe, expect, it } from "bun:test";
import { EXECUTE_TOOL_ERROR_CODES } from "../../errors/index.js";
import { extractExecuteArguments } from "../extract-execute-arguments.js";

describe("extractExecuteArguments", () => {
	it("should extract command from arguments", () => {
		const args = { kind: "execute", command: "npm run build" } as const;
		const result = extractExecuteArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.command).toBe("npm run build");
		}
	});

	it("should extract command as null when not present", () => {
		const args = { kind: "execute" } as const;
		const result = extractExecuteArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.command).toBeNull();
		}
	});

	it("should return null command when other fields present", () => {
		const args = { kind: "execute", other: "value" } as const;
		const result = extractExecuteArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.command).toBeNull();
		}
	});

	it("should return error for null arguments", () => {
		const result = extractExecuteArguments(null);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for undefined arguments", () => {
		const result = extractExecuteArguments(undefined);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for non-object arguments", () => {
		// TypeScript will prevent this at compile time, but we test runtime behavior
		const result = extractExecuteArguments("not an object" as any);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for missing kind field", () => {
		const args = { command: "npm run build" } as any;
		const result = extractExecuteArguments(args);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for wrong kind field", () => {
		const args = { kind: "edit", command: "npm run build" } as any;
		const result = extractExecuteArguments(args);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});
});
