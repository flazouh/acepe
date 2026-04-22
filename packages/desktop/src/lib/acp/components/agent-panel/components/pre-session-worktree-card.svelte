<script lang="ts">
import { AgentPanelPreSessionWorktreeCard as SharedPreSessionWorktreeCard } from "@acepe/ui/agent-panel";
import { extractProjectName } from "$lib/acp/utils/path-utils.js";
import SetupCommandsEditor from "$lib/components/settings-page/sections/worktrees/setup-commands-editor.svelte";

interface Props {
	pendingWorktreeEnabled: boolean;
	alwaysEnabled?: boolean;
	failureMessage?: string | null;
	projectPath?: string;
	projectName?: string | null;
	onYes: () => void;
	onNo: () => void;
	onAlways: () => void;
	onDismiss: () => void;
	onRetry?: () => void;
}

let {
	pendingWorktreeEnabled,
	alwaysEnabled = false,
	failureMessage = null,
	projectPath = undefined,
	projectName = null,
	onYes,
	onNo,
	onAlways,
	onDismiss,
	onRetry,
}: Props = $props();

const resolvedProjectName = $derived(
	projectPath ? (projectName ?? extractProjectName(projectPath)) : null
);
</script>

<SharedPreSessionWorktreeCard
	label="Worktree"
	yesLabel="Yes"
	noLabel="No"
	alwaysLabel="Remember"
	{pendingWorktreeEnabled}
	{alwaysEnabled}
	{failureMessage}
	retryLabel="Retry"
	dismissLabel="Dismiss"
	setupScriptsLabel={projectPath ? "Setup scripts" : null}
	{onYes}
	{onNo}
	{onAlways}
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
