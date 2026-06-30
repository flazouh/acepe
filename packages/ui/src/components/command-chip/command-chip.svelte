<script lang="ts">
	import { IconAdjustments, IconArrowRight } from "@tabler/icons-svelte";
	import AgentToolCard from "../agent-panel/agent-tool-card.svelte";
	import { RoundedIcon } from "../icons/index.js";
	import type { CommandChipModel } from "./command-chip.types.js";

	interface Props {
		model: CommandChipModel;
		class?: string;
	}

	let { model, class: className = "" }: Props = $props();

	const hasModelDisplay = $derived(
		Boolean(model.isModelCommand && model.displayModelName && model.displayModelName.length > 0),
	);
	const commandLabel = $derived(
		model.command.length > 0 ? model.command : model.message.length > 0 ? model.message : "Command",
	);
	const stdoutPreview = $derived(
		model.cleanStdout && model.cleanStdout.length > 0
			? model.cleanStdout
			: model.stdout.length > 0
				? model.stdout
				: null,
	);
</script>

<AgentToolCard class={className} dataTestid="command-output-card">
	{#if hasModelDisplay}
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconAdjustments class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="text-muted-foreground">Model</span>
			<IconArrowRight class="h-3 w-3 shrink-0 text-muted-foreground/50" />
			<span class="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
				{model.displayModelName}
			</span>
			{#if model.displayModelDescription}
				<span class="truncate text-[10px] text-muted-foreground/60">
					{model.displayModelDescription}
				</span>
			{/if}
		</div>
	{:else if model.command.length > 0}
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<RoundedIcon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="shrink-0 font-mono text-muted-foreground">{commandLabel}</span>
			{#if stdoutPreview}
				<span class="truncate text-muted-foreground/70">{stdoutPreview}</span>
			{/if}
		</div>
	{:else if stdoutPreview}
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<RoundedIcon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="truncate text-muted-foreground/70">{stdoutPreview}</span>
		</div>
	{:else}
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<RoundedIcon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="text-muted-foreground/50 italic">Command output</span>
		</div>
	{/if}
</AgentToolCard>
