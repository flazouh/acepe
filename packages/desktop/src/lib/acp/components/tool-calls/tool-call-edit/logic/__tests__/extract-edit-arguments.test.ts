import { describe, expect, it } from "bun:test";
import { EDIT_TOOL_ERROR_CODES } from "../../errors/index.js";
import { extractEditArguments } from "../extract-edit-arguments.js";

describe("extractEditArguments", () => {
	it("should extract file path, old_string, and new_string", () => {
		const args = {
			kind: "edit",
			file_path: "src/lib/utils/format.ts",
			old_string:
				"export function formatDate(date: Date): string {\n  return date.toISOString();\n}",
			new_string:
				"export function formatDate(date: Date): string {\n  return date.toLocaleDateString();\n}",
		} as const;

		const result = extractEditArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.filePath).toBe("src/lib/utils/format.ts");
			expect(result.value.oldString).toBe(
				"export function formatDate(date: Date): string {\n  return date.toISOString();\n}"
			);
			expect(result.value.newString).toBe(
				"export function formatDate(date: Date): string {\n  return date.toLocaleDateString();\n}"
			);
		}
	});

	it("should extract content when new_string is not present", () => {
		const args = {
			kind: "edit",
			file_path: "src/components/Button.svelte",
			content: "<script>\n  export let label: string;\n</script>\n\n<button>{label}</button>",
		} as const;

		const result = extractEditArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.newString).toBe(
				"<script>\n  export let label: string;\n</script>\n\n<button>{label}</button>"
			);
			expect(result.value.oldString).toBeNull();
		}
	});

	it("should handle null old_string (new file creation)", () => {
		const args = {
			kind: "edit",
			file_path: "src/lib/api/client.ts",
			new_string:
				"import { Result } from 'neverthrow';\n\nexport class ApiClient {\n  async fetch(url: string): Promise<Result<Response, Error>> {\n    // Implementation\n  }\n}",
		} as const;

		const result = extractEditArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.oldString).toBeNull();
			expect(result.value.newString).toContain("export class ApiClient");
		}
	});

	it("should return error for null arguments", () => {
		const result = extractEditArguments(null);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EDIT_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for undefined arguments", () => {
		const result = extractEditArguments(undefined);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EDIT_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should return error for non-object arguments", () => {
		const result = extractEditArguments("not an object" as any);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe(EDIT_TOOL_ERROR_CODES.INVALID_ARGUMENTS);
		}
	});

	it("should handle filePath variations", () => {
		const args1 = {
			kind: "edit",
			file_path: "packages/desktop/src/lib/utils.ts",
			new_string: "export const VERSION = '1.0.0';",
		} as const;
		const args2 = {
			kind: "edit",
			file_path: "packages/desktop/src/lib/utils.ts",
			new_string: "export const VERSION = '1.0.0';",
		} as const;
		const args3 = {
			kind: "edit",
			file_path: "packages/desktop/src/lib/utils.ts",
			new_string: "export const VERSION = '1.0.0';",
		} as const;

		const result1 = extractEditArguments(args1);
		const result2 = extractEditArguments(args2);
		const result3 = extractEditArguments(args3);

		expect(result1.isOk()).toBe(true);
		expect(result2.isOk()).toBe(true);
		expect(result3.isOk()).toBe(true);

		if (result1.isOk() && result2.isOk() && result3.isOk()) {
			expect(result1.value.filePath).toBe("packages/desktop/src/lib/utils.ts");
			expect(result2.value.filePath).toBe("packages/desktop/src/lib/utils.ts");
			expect(result3.value.filePath).toBe("packages/desktop/src/lib/utils.ts");
		}
	});

	it("should handle null file path", () => {
		const args = {
			kind: "edit",
			new_string: "content",
		} as const;

		const result = extractEditArguments(args);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.filePath).toBeNull();
		}
	});
});
