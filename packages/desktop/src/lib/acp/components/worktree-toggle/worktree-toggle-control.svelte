<script lang="ts">
import { cn } from "$lib/utils.js";
import SetupScriptsDialog from "../agent-panel/components/setup-scripts-dialog.svelte";
import type { OnWorktreeCreatedCallback, OnWorktreeRenamedCallback } from "./types.js";
import WorktreeToggle from "./worktree-toggle.svelte";

interface Props {
	panelId: string;
	projectPath: string;
	projectName?: string | null;
	activeWorktreePath: string | null;
	hasEdits: boolean;
	hasMessages: boolean;
	globalWorktreeDefault?: boolean;
	worktreeDeleted?: boolean;
	variant?: "default" | "minimal";
	onWorktreeCreated: OnWorktreeCreatedCallback;
	onWorktreeRenamed?: OnWorktreeRenamedCallback;
	onPendingChange?: (pending: boolean) => void;
}

let {
	panelId,
	projectPath,
	projectName = null,
	activeWorktreePath,
	hasEdits,
	hasMessages,
	globalWorktreeDefault = false,
	worktreeDeleted = false,
	variant = "default",
	onWorktreeCreated,
	onWorktreeRenamed,
	onPendingChange,
}: Props = $props();

const resolvedProjectName = $derived(
	projectName !== null ? projectName : extractProjectName(projectPath)
);
const wrapperClass = $derived(
	cn("flex items-center h-full w-full", variant === "default" ? "border-r border-border/50" : "")
);

let setupScriptsOpen = $state(false);

function extractProjectName(path: string): string {
	const parts = path.split("/");
	const name = parts[parts.length - 1] ? parts[parts.length - 1] : "Unknown";
	return name
		.split(/[-_]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}
</script>

<div class={wrapperClass}>
	<WorktreeToggle
		{panelId}
		{projectPath}
		{activeWorktreePath}
		{hasEdits}
		{hasMessages}
		{globalWorktreeDefault}
		{worktreeDeleted}
		{variant}
		{onWorktreeCreated}
		{onWorktreeRenamed}
		onOpenSettings={() => {
			setupScriptsOpen = true;
		}}
		{onPendingChange}
	/>
</div>

<SetupScriptsDialog
	open={setupScriptsOpen}
	onOpenChange={(value) => (setupScriptsOpen = value)}
	{projectPath}
	projectName={resolvedProjectName}
/>
