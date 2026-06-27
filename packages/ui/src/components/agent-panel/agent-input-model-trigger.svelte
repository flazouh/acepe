<!--
  AgentInputModelTrigger - Pill-shaped button showing the selected model with dropdown caret.

  Visual slice extracted from packages/desktop/src/lib/acp/components/model-selector.trigger.svelte.
  Presentational model trigger label. Composed by AgentInputStandardModelSelector via Selector.
-->
<script lang="ts">
	import { CaretDown } from "phosphor-svelte";

	interface Props {
		label: string;
		agentIconSrc?: string | null;
		disabled?: boolean;
		title?: string;
		onclick?: () => void;
	}

	let {
		label,
		agentIconSrc = null,
		disabled = false,
		title = "",
		onclick,
	}: Props = $props();
</script>

<button
	type="button"
	{disabled}
	{title}
	{onclick}
	class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-foreground/85 transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
>
	{#if agentIconSrc}
		<img src={agentIconSrc} alt="" class="h-3 w-3 shrink-0" role="presentation" />
	{/if}
	<span class="truncate max-w-[180px]">{label}</span>
	<CaretDown class="h-2.5 w-2.5 text-muted-foreground shrink-0" weight="bold" />
</button>
