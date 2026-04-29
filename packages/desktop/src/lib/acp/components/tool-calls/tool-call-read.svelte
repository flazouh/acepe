<script lang="ts">
import { AgentToolRead } from "@acepe/ui/agent-panel";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { gitStatusCache } from "../../services/git-status-cache.svelte.js";
import { getPanelStore, getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { findGitStatusForFile, getFileName, getRelativeFilePath } from "../../utils/file-utils.js";
import { getToolPresentationStatus, getToolStatus } from "../../utils/tool-state-utils.js";

interface ToolCallReadProps {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState, projectPath, elapsedLabel }: ToolCallReadProps = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const sessionContext = useSessionContext();
const ownerPanelId = $derived(sessionContext?.panelId);

// Get tool status
const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Extract file path (streaming args first for progressive display)
const filePath = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "read" && streamingArgs.file_path) {
		return streamingArgs.file_path;
	}
	if (streamingArgs?.kind === "read" && streamingArgs.source_context?.path) {
		return streamingArgs.source_context.path;
	}
	return toolCall.arguments.kind === "read"
		? (toolCall.arguments.file_path ?? toolCall.arguments.source_context?.path ?? null)
		: null;
});
const fileName = $derived(filePath ? getFileName(filePath) : null);
const sourceExcerpt = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (streamingArgs?.kind === "read" && streamingArgs.source_context?.excerpt) {
		return streamingArgs.source_context.excerpt;
	}
	return toolCall.arguments.kind === "read"
		? (toolCall.arguments.source_context?.excerpt ?? null)
		: null;
});
const sourceRangeLabel = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	const range =
		streamingArgs?.kind === "read"
			? (streamingArgs.source_context?.viewRange ?? null)
			: toolCall.arguments.kind === "read"
				? (toolCall.arguments.source_context?.viewRange ?? null)
				: null;
	if (!range) {
		return null;
	}

	const start = range.startLine;
	const end = range.endLine;
	if (start === null || start === undefined) {
		return end === null || end === undefined ? null : `Lines ${end}`;
	}
	if (end === null || end === undefined || end === start) {
		return `Line ${start}`;
	}
	return `Lines ${start}-${end}`;
});

// Git diff stats state
let linesAdded = $state(0);
let linesRemoved = $state(0);

// Whether clicking the file should open the file panel
const isFileClickable = $derived(Boolean(filePath && projectPath));

// Convert absolute file path to relative path for git status matching
const relativeFilePath = $derived(getRelativeFilePath(filePath, projectPath));

// Fetch git status for the file to get diff stats
$effect(() => {
	const currentFilePath = filePath;
	const currentRelativePath = relativeFilePath;
	const currentProjectPath = projectPath;

	// Reset stats when file changes
	linesAdded = 0;
	linesRemoved = 0;

	if (!currentRelativePath || !currentProjectPath) {
		return;
	}

	gitStatusCache.getProjectGitStatusMap(currentProjectPath).match(
		(statusMap) => {
			if (filePath === currentFilePath && projectPath === currentProjectPath) {
				const fileStatus =
					statusMap.get(currentRelativePath) ??
					findGitStatusForFile(Array.from(statusMap.values()), currentFilePath, currentProjectPath);
				if (fileStatus) {
					linesAdded = fileStatus.insertions;
					linesRemoved = fileStatus.deletions;
				}
			}
		},
		() => {
			// Silently ignore git status errors
		}
	);
});

function handleFileClick() {
	if (filePath && projectPath) {
		panelStore.openFilePanel(relativeFilePath ?? filePath, projectPath, { ownerPanelId });
	}
}

// Map tool status to AgentToolStatus
const agentStatus = $derived(getToolPresentationStatus(toolCall, turnState));
</script>

<AgentToolRead
	{filePath}
	{fileName}
	{sourceExcerpt}
	{sourceRangeLabel}
	additions={linesAdded}
	deletions={linesRemoved}
	status={agentStatus}
	durationLabel={elapsedLabel ?? undefined}
	iconBasePath="/svgs/icons"
	interactive={isFileClickable}
	onSelect={isFileClickable ? handleFileClick : undefined}
	runningLabel={"Reading"}
	doneLabel={"Read"}
/>
