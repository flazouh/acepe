<script lang="ts">
import type { Component } from "svelte";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import { mergePermissionArgs } from "../../utils/merge-permission-args.js";
import { formatToolElapsedLabel, getToolStatus } from "../../utils/tool-state-utils.js";
// Collapsible tool components - each kind has its own dedicated component
import ToolCallCreatePlan from "./tool-call-create-plan.svelte";
import ToolCallDelete from "./tool-call-delete.svelte";
import ToolCallEdit from "./tool-call-edit.svelte";
import ToolCallEnterPlanMode from "./tool-call-enter-plan-mode.svelte";
import ToolCallExecute from "./tool-call-execute.svelte";
import ToolCallExitPlanMode from "./tool-call-exit-plan-mode.svelte";
import ToolCallFetch from "./tool-call-fetch.svelte";
import ToolCallQuestion from "./tool-call-question.svelte";
import ToolCallRead from "./tool-call-read.svelte";
import ToolCallReadLints from "./tool-call-read-lints.svelte";
import ToolCallSearch from "./tool-call-search.svelte";
import ToolCallSimple from "./tool-call-simple.svelte";
import ToolCallSkill from "./tool-call-skill.svelte";
import ToolCallTask from "./tool-call-task.svelte";
import ToolCallTaskOutput from "./tool-call-task-output.svelte";
import ToolCallThink from "./tool-call-think.svelte";
import ToolCallTodo from "./tool-call-todo.svelte";
import ToolCallWebSearch from "./tool-call-web-search.svelte";

/**
 * Props for tool call components.
 */
type ToolComponentProps = {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
	pendingPermission?: PermissionRequest | null;
};

/**
 * Kind → Component mapping for tools with dedicated components.
 * Each kind routes directly to its dedicated component.
 * Tools not listed here use ToolCallSimple.
 */

const DEDICATED_COMPONENTS: Partial<Record<ToolKind, Component<ToolComponentProps>>> = {
	read: ToolCallRead,
	edit: ToolCallEdit,
	execute: ToolCallExecute,
	search: ToolCallSearch,
	glob: ToolCallSearch,
	fetch: ToolCallFetch,
	web_search: ToolCallWebSearch,
	enter_plan_mode: ToolCallEnterPlanMode,
	exit_plan_mode: ToolCallExitPlanMode,
	create_plan: ToolCallCreatePlan,
	delete: ToolCallDelete,
	// Each agent tool has its own dedicated component
	think: ToolCallThink,
	todo: ToolCallTodo,
	question: ToolCallQuestion,
	task: ToolCallTask,
	task_output: ToolCallTaskOutput,
	skill: ToolCallSkill,
};

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	/**
	 * Project path for file operations (e.g., reading full file content in Edit modal).
	 */
	projectPath?: string;
}

let { toolCall, turnState = "idle", projectPath }: Props = $props();
let nowMs = $state(Date.now());

const permissionStore = getPermissionStore();
const pendingPermission = $derived(permissionStore.getForToolCall(toolCall.id));

// Get the tool kind directly from the toolCall (Rust always provides this)
// Default to "other" only as a safety net - should never happen in practice
const resolvedKind = $derived<ToolKind>(toolCall.kind ?? "other");

// Merge permission rawInput into arguments so child components see file paths, commands, etc.
// Preserves original toolCall.title (may contain agent-provided data like backtick-wrapped
// commands) — display titles are derived by each component via getToolKindTitle.
const enrichedToolCall = $derived<ToolCall>({
	...toolCall,
	arguments: mergePermissionArgs(toolCall.arguments, pendingPermission),
});

// Get the component: dedicated by kind, with special case for Read Lints, else ToolCallSimple
const ToolComponent = $derived.by(() => {
	if (
		resolvedKind === "read" &&
		(enrichedToolCall.title?.trim() === "Read Lints" || enrichedToolCall.name === "read_lints")
	) {
		return ToolCallReadLints;
	}
	return DEDICATED_COMPONENTS[resolvedKind] ?? ToolCallSimple;
});

const toolStatus = $derived(getToolStatus(toolCall, turnState));
const elapsedLabel = $derived(
	formatToolElapsedLabel({
		startedAtMs: toolCall.startedAtMs,
		completedAtMs: toolCall.completedAtMs,
		isRunning: toolStatus.isPending,
		nowMs,
	})
);

$effect(() => {
	if (!toolStatus.isPending || toolCall.startedAtMs === undefined) {
		return;
	}

	nowMs = Date.now();
	const intervalId = window.setInterval(() => {
		nowMs = Date.now();
	}, 1000);

	return () => {
		window.clearInterval(intervalId);
	};
});
</script>

<!-- DEBUG: kind={resolvedKind} -->
<ToolComponent
	toolCall={enrichedToolCall}
	{turnState}
	{projectPath}
	{elapsedLabel}
	pendingPermission={pendingPermission ? pendingPermission : null}
/>
