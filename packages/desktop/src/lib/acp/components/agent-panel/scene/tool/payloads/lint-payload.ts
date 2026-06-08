import type { ToolCall } from "../../../../../types/tool-call.js";
import { getToolResultObject } from "../tool-result.js";

export function mapLintDiagnostics(toolCall: ToolCall):
	| {
			filePath?: string | null;
			line?: number | null;
			message?: string | null;
			severity?: string | null;
	  }[]
	| undefined {
	if (toolCall.kind !== "read_lints") {
		return undefined;
	}

	const resultObject = getToolResultObject(toolCall);
	if (!resultObject || !Array.isArray(resultObject.diagnostics)) {
		return undefined;
	}

	return resultObject.diagnostics
		.filter((diagnostic): diagnostic is Record<string, unknown> => {
			return diagnostic !== null && typeof diagnostic === "object";
		})
		.map((diagnostic) => {
			return {
				filePath:
					typeof diagnostic.filePath === "string"
						? diagnostic.filePath
						: typeof diagnostic.file_path === "string"
							? diagnostic.file_path
							: null,
				line:
					typeof diagnostic.line === "number"
						? diagnostic.line
						: typeof diagnostic.lineNumber === "number"
							? diagnostic.lineNumber
							: null,
				message: typeof diagnostic.message === "string" ? diagnostic.message : null,
				severity: typeof diagnostic.severity === "string" ? diagnostic.severity : null,
			};
		});
}
