<script lang="ts">
	import { AgentPanelPreSessionWorktreeCard as SharedPreSessionWorktreeCard } from "@acepe/ui/agent-panel";

	interface Props {
		pendingWorktreeEnabled: boolean;
		alwaysEnabled?: boolean;
		failureMessage?: string | null;
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
		onYes,
		onNo,
		onAlways,
		onDismiss,
		onRetry,
	}: Props = $props();
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
	{onYes}
	{onNo}
	{onAlways}
	{onDismiss}
	{onRetry}
/>
