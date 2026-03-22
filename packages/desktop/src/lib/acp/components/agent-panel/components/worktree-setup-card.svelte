<script lang="ts">
import SpinnerGap from "phosphor-svelte/lib/SpinnerGap";
import WarningCircle from "phosphor-svelte/lib/WarningCircle";
import * as m from "$lib/paraglide/messages.js";
import type { WorktreeSetupState } from "../logic/worktree-setup-events.js";
import AnimatedChevron from "../../animated-chevron.svelte";

interface Props {
	state: WorktreeSetupState;
}

let { state: setupState }: Props = $props();

let isExpanded = $state(true);

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

function toggleExpanded(): void {
	isExpanded = !isExpanded;
}
</script>

{#if setupState.isVisible}
	<div class="w-full px-5 mb-2">
		{#if isExpanded}
			<div class="rounded-t-lg bg-accent/50 overflow-hidden">
				<div class="max-h-[240px] overflow-y-auto px-3 py-2">
					<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{setupState.outputText || (setupState.status === "creating-worktree" ? m.worktree_toggle_creating() : m.settings_worktree_setup_running())}</pre>
				</div>
			</div>
		{/if}

		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleExpanded();
				}
			}}
			class="w-full flex items-center justify-between px-3 py-1 rounded-lg bg-accent hover:bg-accent/80 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none'
				: ''}"
		>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				{#if setupState.status === "failed"}
					<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
				{:else}
					<SpinnerGap size={13} class="shrink-0 animate-spin text-muted-foreground" />
				{/if}

				<span class="font-medium text-foreground shrink-0">
					{setupState.status === "failed"
						? m.settings_worktree_setup_failed()
						: setupState.status === "creating-worktree"
							? m.worktree_toggle_creating()
						: m.settings_worktree_setup_running()}
				</span>

				<span class="truncate text-muted-foreground">
					{summaryText}
				</span>
			</div>

			<div class="flex items-center gap-2 shrink-0">
				{#if progressText}
					<span class="tabular-nums text-muted-foreground text-[0.6875rem]">
						{progressText}
					</span>
				{/if}
				<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
			</div>
		</div>
	</div>
{/if}
