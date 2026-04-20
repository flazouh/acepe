<script lang="ts">
import { AgentPanelWorktreeSetupCard as SharedAgentPanelWorktreeSetupCard } from "@acepe/ui/agent-panel";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { WarningCircle } from "phosphor-svelte";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";

interface Props {
	state: WorktreeSetupState;
}

let { state: setupState }: Props = $props();

const summaryText = $derived.by(() => {
	if (setupState.status === "creating-worktree") return "Creating worktree...";
	if (setupState.status === "failed" && setupState.error) return setupState.error;
	if (setupState.activeCommand) return setupState.activeCommand;
	return "Running setup...";
});
const titleText = $derived.by(() => {
	if (setupState.status === "failed") {
		return "Setup script failed";
	}

	if (setupState.status === "creating-worktree") {
		return "Creating worktree...";
	}

	return "Running setup...";
});
const detailsText = $derived(
	setupState.outputText ||
		(setupState.status === "creating-worktree"
			? "Creating worktree..."
			: "Running setup...")
);
</script>

<SharedAgentPanelWorktreeSetupCard
	visible={setupState.isVisible}
	title={titleText}
	summary={summaryText}
	details={detailsText}
	tone={setupState.status === "failed" ? "error" : "running"}
>
	{#snippet leading()}
		{#if setupState.status === "failed"}
			<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
		{:else}
			<Spinner class="size-[13px]" />
		{/if}
	{/snippet}
</SharedAgentPanelWorktreeSetupCard>
