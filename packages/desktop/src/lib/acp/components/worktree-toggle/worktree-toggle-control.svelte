<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { Gear } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils.js";
import SetupScriptsDialog from "../agent-panel/components/setup-scripts-dialog.svelte";
import type { OnWorktreeCreatedCallback } from "./types.js";
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
	hideWorktreeButton?: boolean;
	variant?: "default" | "minimal";
	onWorktreeCreated: OnWorktreeCreatedCallback;
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
	hideWorktreeButton = false,
	variant = "default",
	onWorktreeCreated,
	onPendingChange,
}: Props = $props();

const resolvedProjectName = $derived(projectName ?? extractProjectName(projectPath));
const wrapperClass = $derived(
	cn("flex items-center h-full w-full", variant === "default" ? "border-r border-border/50" : "")
);
const setupButtonClass = $derived(
	cn(
		"hover:!text-foreground",
		variant === "minimal" ? "hover:!bg-accent/40 rounded-md" : "hover:!bg-transparent"
	)
);

let setupScriptsOpen = $state(false);

function extractProjectName(path: string): string {
	const parts = path.split("/");
	const name = parts[parts.length - 1] ?? "Unknown";
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
		{hideWorktreeButton}
		{variant}
		{onWorktreeCreated}
		{onPendingChange}
	>
		{#snippet children()}
			<div class="flex items-center h-full">
				<EmbeddedIconButton
					title={m.settings_worktree_section()}
					ariaLabel={m.settings_worktree_section()}
					active={setupScriptsOpen}
					class={setupButtonClass}
					onclick={() => {
						setupScriptsOpen = !setupScriptsOpen;
					}}
				>
					<Gear class="h-3.5 w-3.5" weight="fill" />
				</EmbeddedIconButton>
			</div>
		{/snippet}
	</WorktreeToggle>
</div>

<SetupScriptsDialog
	open={setupScriptsOpen}
	onOpenChange={(value) => (setupScriptsOpen = value)}
	{projectPath}
	projectName={resolvedProjectName}
/>
