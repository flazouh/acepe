<script lang="ts">
import { AgentToolEdit } from "@acepe/ui/agent-panel";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import * as m from "$lib/paraglide/messages.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { getPanelStore, getSessionStore } from "../../store/index.js";
import type { TurnState } from "../../store/types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import { calculateDiffStats, getFileName, getRelativeFilePath } from "../../utils/file-utils.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../utils/pierre-diffs-theme.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { getWorkerPool } from "../../utils/worker-pool-singleton.js";
import { extractPermissionFilePath } from "./permission-display.js";

interface ToolCallEditProps {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
	pendingPermission?: PermissionRequest | null;
}

let {
	toolCall,
	turnState,
	projectPath,
	elapsedLabel,
	pendingPermission = null,
}: ToolCallEditProps = $props();

const sessionStore = getSessionStore();
const panelStore = getPanelStore();
const sessionContext = useSessionContext();
const ownerPanelId = $derived(sessionContext?.panelId);
const themeState = useTheme();
const toolStatus = $derived(getToolStatus(toolCall, turnState));
const locationFilePath = $derived(toolCall.locations?.[0]?.path ?? null);
const permissionFilePath = $derived(
	pendingPermission ? extractPermissionFilePath(pendingPermission) : null
);

function normalizeFilePath(value: string | null | undefined): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

// Merge streaming args with tool call args for progressive display
const mergedArgs = $derived.by(() => {
	const streamingArgs = sessionStore.getStreamingArguments(toolCall.id);
	if (!streamingArgs || streamingArgs.kind !== "edit") return toolCall.arguments;

	const base = toolCall.arguments;
	if (base.kind === "edit") {
		return {
			...base,
			file_path: streamingArgs.file_path ?? base.file_path,
			old_string: streamingArgs.old_string ?? base.old_string,
			new_string: streamingArgs.new_string ?? base.new_string,
			content: streamingArgs.content ?? base.content,
		};
	}
	return base;
});

const filePath = $derived(
	mergedArgs.kind === "edit"
		? (normalizeFilePath(mergedArgs.file_path) ??
				normalizeFilePath(locationFilePath) ??
				normalizeFilePath(permissionFilePath))
		: null
);
const fileName = $derived(getFileName(filePath));
const diffStats = $derived(calculateDiffStats(mergedArgs));

const oldString = $derived(mergedArgs.kind === "edit" ? (mergedArgs.old_string ?? null) : null);
const newString = $derived(
	mergedArgs.kind === "edit" ? (mergedArgs.new_string ?? mergedArgs.content ?? null) : null
);

// Streaming detection
const isStreaming = $derived(
	toolStatus.isInputStreaming || (toolStatus.isPending && turnState === "streaming")
);

// Don't treat as streaming when waiting for permission approval
// (tool has all its data, just needs user consent)
const isDiffStreaming = $derived(pendingPermission ? false : isStreaming);

// Map tool status to AgentToolStatus
const agentStatus = $derived.by(() => {
	if (toolStatus.isPending) return "running" as const;
	if (toolStatus.isError) return "error" as const;
	return "done" as const;
});
const isApplied = $derived(toolStatus.isSuccess);
const isAwaitingApproval = $derived(
	Boolean(pendingPermission) && !isApplied && !toolStatus.isError
);

const isFileClickable = $derived(Boolean(filePath && projectPath));

function handleFileClick() {
	if (filePath && projectPath) {
		panelStore.openFilePanel(getRelativeFilePath(filePath, projectPath) ?? filePath, projectPath, {
			ownerPanelId,
		});
	}
}

// Pierre diffs configuration
const effectiveTheme = $derived(themeState.effectiveTheme);
const workerPool = getWorkerPool();
const themeNames = { dark: "Cursor Dark", light: "pierre-light" };
</script>

<AgentToolEdit
	{filePath}
	{fileName}
	additions={diffStats?.added ?? 0}
	deletions={diffStats?.removed ?? 0}
	{oldString}
	{newString}
	isStreaming={isDiffStreaming}
	status={agentStatus}
	applied={isApplied}
	awaitingApproval={isAwaitingApproval}
	durationLabel={elapsedLabel ?? undefined}
	iconBasePath="/svgs/icons"
	interactive={isFileClickable}
	onSelect={isFileClickable ? handleFileClick : undefined}
	theme={effectiveTheme}
	{themeNames}
	{workerPool}
	onBeforeRender={registerCursorThemeForPierreDiffs}
	unsafeCSS={pierreDiffsUnsafeCSS}
	editingLabel={m.tool_edit_editing()}
	editedLabel={m.tool_edit_edited()}
	awaitingApprovalLabel={m.tool_edit_awaiting_approval()}
	interruptedLabel={m.tool_edit_interrupted()}
	failedLabel={m.tool_edit_failed()}
	pendingLabel={m.tool_edit_pending()}
	preparingLabel={m.tool_edit_preparing_label()}
	ariaCollapseDiff={m.aria_collapse_diff()}
	ariaExpandDiff={m.aria_expand_diff()}
/>
