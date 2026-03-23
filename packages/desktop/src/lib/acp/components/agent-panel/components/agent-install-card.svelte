<script lang="ts">
import { Spinner } from "$lib/components/ui/spinner/index.js";
import WarningCircle from "phosphor-svelte/lib/WarningCircle";
import * as m from "$lib/paraglide/messages.js";
import AnimatedChevron from "../../animated-chevron.svelte";
import AgentIcon from "../../agent-icon.svelte";

interface Props {
	agentId: string;
	agentName: string;
	stage: string;
	progress: number;
	failed: boolean;
	onRetry?: () => void;
}

let { agentId, agentName, stage, progress, failed, onRetry }: Props = $props();

let isExpanded = $state(false);

const progressPercent = $derived(Math.round(progress * 100));
</script>

<div class="w-full px-5 mb-2">
	<div
		role="button"
		tabindex="0"
		onclick={() => (isExpanded = !isExpanded)}
		onkeydown={(event: KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				isExpanded = !isExpanded;
			}
		}}
		class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/80 transition-colors cursor-pointer"
	>
		<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
			{#if failed}
				<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
			{:else}
				<Spinner class="size-[13px]" />
			{/if}

			<AgentIcon {agentId} class="size-3 shrink-0" size={12} />

			<span class="font-medium text-foreground shrink-0">
				{#if failed}
					{m.agent_install_failed()}
				{:else}
					{m.agent_install_setting_up({ agentName })}
				{/if}
			</span>

			<span class="truncate text-muted-foreground">
				{stage}
			</span>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			{#if failed && onRetry}
				<button
					type="button"
					class="text-[0.6875rem] text-primary hover:text-primary/80 font-medium"
					onclick={(e: MouseEvent) => { e.stopPropagation(); onRetry?.(); }}
				>
					{m.agent_install_retry()}
				</button>
			{:else if progress > 0}
				<span class="tabular-nums text-muted-foreground text-[0.6875rem]">
					{progressPercent}%
				</span>
			{/if}
			<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
		</div>
	</div>

	{#if isExpanded}
		<div class="rounded-b-lg bg-accent/50 overflow-hidden">
			<div class="px-3 py-2">
				<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{stage}</pre>
			</div>
		</div>
	{/if}
</div>
