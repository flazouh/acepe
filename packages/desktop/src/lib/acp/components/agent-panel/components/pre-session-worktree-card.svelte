<script lang="ts">
import { AgentPanelPreSessionWorktreeCard as SharedPreSessionWorktreeCard } from "@acepe/ui/agent-panel";
import SetupCommandsEditor from "$lib/components/settings-page/sections/worktrees/setup-commands-editor.svelte";

interface Props {
	variant?: "card" | "trigger";
	menuSide?: "top" | "bottom";
	pendingWorktreeEnabled: boolean;
	failureMessage?: string | null;
	projectPath?: string;
	projectName?: string | null;
	onYes: () => void;
	onNo: () => void;
	onDismiss: () => void;
	onRetry?: () => void;
}

let {
	variant = "card",
	menuSide = "bottom",
	pendingWorktreeEnabled,
	failureMessage = null,
	projectPath = undefined,
	projectName = null,
	onYes,
	onNo,
	onDismiss,
	onRetry,
}: Props = $props();
</script>

<SharedPreSessionWorktreeCard
	{variant}
	{menuSide}
	{pendingWorktreeEnabled}
	{failureMessage}
	retryLabel="Retry"
	dismissLabel="Dismiss"
	setupScriptsLabel={projectPath ? "Setup scripts" : null}
	{onYes}
	{onNo}
	{onDismiss}
	{onRetry}
>
	{#snippet expandedContent()}
		{#if projectPath}
			{#key projectPath}
				<SetupCommandsEditor {projectPath} />
			{/key}
		{/if}
	{/snippet}
</SharedPreSessionWorktreeCard>
