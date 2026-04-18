<script lang="ts">
import type { LintDiagnostic } from "@acepe/ui/agent-panel";

import { AgentToolReadLints } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";

import { getToolStatus } from "../../utils/tool-state-utils.js";

interface ToolCallReadLintsProps {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, elapsedLabel }: ToolCallReadLintsProps = $props();

const toolStatus = $derived(getToolStatus(toolCall, turnState));

const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});

// Parse result: { totalDiagnostics?, totalFiles?, numFiles?, diagnostics? }
const parsedResult = $derived.by(() => {
	const raw = toolCall.result;
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		return { totalDiagnostics: 0, totalFiles: 0, diagnostics: null as LintDiagnostic[] | null };
	}
	const obj = raw as Record<string, unknown>;
	const totalDiagnostics =
		(typeof obj.totalDiagnostics === "number" ? obj.totalDiagnostics : null) ??
		(typeof obj.numDiagnostics === "number" ? obj.numDiagnostics : null) ??
		0;
	const totalFiles =
		(typeof obj.totalFiles === "number" ? obj.totalFiles : null) ??
		(typeof obj.numFiles === "number" ? obj.numFiles : null) ??
		0;
	let diagnostics: LintDiagnostic[] | null = null;
	if (Array.isArray(obj.diagnostics)) {
		diagnostics = obj.diagnostics
			.filter((d): d is Record<string, unknown> => d != null && typeof d === "object")
			.map((d) => ({
				filePath:
					typeof d.filePath === "string"
						? d.filePath
						: typeof d.file_path === "string"
							? d.file_path
							: null,
				line:
					typeof d.line === "number"
						? d.line
						: typeof d.lineNumber === "number"
							? d.lineNumber
							: null,
				message: typeof d.message === "string" ? d.message : null,
				severity: typeof d.severity === "string" ? d.severity : null,
			}));
	}
	return { totalDiagnostics, totalFiles, diagnostics };
});
</script>

<AgentToolReadLints
	status={agentStatus}
	totalDiagnostics={parsedResult.totalDiagnostics}
	totalFiles={parsedResult.totalFiles}
	diagnostics={parsedResult.diagnostics}
	durationLabel={elapsedLabel ?? undefined}
	runningLabel={"Checking lints"}
	doneLabel={"Read lints"}
	noIssuesLabel={"No issues"}
	summaryLabel={`${parsedResult.totalDiagnostics} issues in ${parsedResult.totalFiles} files`}
	ariaCollapse={"Collapse lint results"}
	ariaExpand={"Expand lint results"}
/>
