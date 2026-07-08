const RAW_EXECUTE_TOOL_NAMES = new Set([
	"bash",
	"exec_command",
	"execcommand",
	"run_command",
	"runcommand",
	"run_terminal_cmd",
	"runterminalcmd",
	"shell",
	"shell_command",
	"shellcommand",
	"terminal",
	"write_stdin",
	"writestdin",
]);

export function normalizedRawToolName(value: string | null | undefined): string {
	return (value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
}

export function isRawExecuteToolName(value: string | null | undefined): boolean {
	const normalized = normalizedRawToolName(value);
	if (RAW_EXECUTE_TOOL_NAMES.has(normalized)) {
		return true;
	}

	if (normalized.startsWith("functions_")) {
		return RAW_EXECUTE_TOOL_NAMES.has(normalized.slice("functions_".length));
	}

	if (normalized.startsWith("codex_")) {
		return RAW_EXECUTE_TOOL_NAMES.has(normalized.slice("codex_".length));
	}

	return false;
}
