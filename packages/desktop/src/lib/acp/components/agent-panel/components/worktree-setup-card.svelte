<script lang="ts">
import { AgentPanelWorktreeSetupCard as SharedAgentPanelWorktreeSetupCard } from "@acepe/ui/agent-panel";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { WarningCircle } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";

interface Props {
	state: WorktreeSetupState;
}

let { state: setupState }: Props = $props();

const summaryText = $derived.by(() => {
	if (setupState.status === "creating-worktree") return m.worktree_toggle_creating();
	if (setupState.status === "failed" && setupState.error) return setupState.error;
	if (setupState.activeCommand) return setupState.activeCommand;
	return m.settings_worktree_setup_running();
});

const progressText = $derived.by(() => {
	if (setupState.commandCount <= 0) return null;
	const currentStep = setupState.activeCommandIndex ?? 0;
	return `${currentStep}/${setupState.commandCount}`;
});
const titleText = $derived.by(() => {
	if (setupState.status === "failed") {
		return m.settings_worktree_setup_failed();
	}

	if (setupState.status === "creating-worktree") {
		return m.worktree_toggle_creating();
	}

	return m.settings_worktree_setup_running();
});
const detailsText = $derived(
	setupState.outputText ||
		(setupState.status === "creating-worktree"
			? m.worktree_toggle_creating()
			: m.settings_worktree_setup_running())
);
</script>

<SharedAgentPanelWorktreeSetupCard
	visible={setupState.isVisible}
	title={titleText}
	summary={summaryText}
	details={detailsText}
	progressLabel={progressText}
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
