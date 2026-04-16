<script lang="ts">
	import { AgentPanelPreSessionWorktreeCard as SharedPreSessionWorktreeCard } from "@acepe/ui/agent-panel";
	import * as m from "$lib/messages.js";
	import { extractProjectName } from "$lib/acp/utils/path-utils.js";
	import SetupScriptsDialog from "./setup-scripts-dialog.svelte";

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

	let setupScriptsOpen = $state(false);

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
	setupScriptsLabel={projectPath ? m.setup_scripts_button_title() : null}
	{onYes}
	{onNo}
	{onAlways}
	{onDismiss}
	{onRetry}
	onSetupScripts={() => {
		if (projectPath) {
			setupScriptsOpen = true;
		}
	}}
/>

{#if projectPath && resolvedProjectName}
	<SetupScriptsDialog
		open={setupScriptsOpen}
		onOpenChange={(value) => (setupScriptsOpen = value)}
		{projectPath}
		projectName={resolvedProjectName}
	/>
{/if}
