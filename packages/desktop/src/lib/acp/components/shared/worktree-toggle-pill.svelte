<script lang="ts">
	import { AgentPanelWorktreeTogglePill } from "@acepe/ui/agent-panel";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import SetupCommandsEditor from "$lib/components/settings-page/sections/worktrees/setup-commands-editor.svelte";

	interface Props {
		/** Pre-session toggle state — true if a worktree will be created on next send. */
		enabled: boolean;
		/** Project path for the setup-scripts popover. When null, no label click action. */
		projectPath: string | null;
		failureMessage?: string | null;
		onToggle: () => void;
		onRetry?: () => void;
		onDismiss?: () => void;
		busy?: boolean;
	}

	let {
		enabled,
		projectPath,
		failureMessage = null,
		onToggle,
		onRetry,
		onDismiss,
		busy = false,
	}: Props = $props();

	let anchorRef = $state<HTMLElement | null>(null);
	let setupOpen = $state(false);

	function handleLabelClick() {
		setupOpen = true;
	}
</script>

<div bind:this={anchorRef} class="inline-flex items-center">
	<AgentPanelWorktreeTogglePill
		label="Worktree"
		{enabled}
		{failureMessage}
		{busy}
		{onToggle}
		{onRetry}
		{onDismiss}
		onLabelClick={projectPath ? handleLabelClick : undefined}
	/>
</div>

{#if projectPath}
	<Popover.Root bind:open={setupOpen}>
		<Popover.Content
			customAnchor={anchorRef ?? undefined}
			align="start"
			side="bottom"
			sideOffset={6}
			class="w-[28rem] max-w-[90vw] p-3"
		>
			{#key projectPath}
				<SetupCommandsEditor {projectPath} />
			{/key}
		</Popover.Content>
	</Popover.Root>
{/if}
