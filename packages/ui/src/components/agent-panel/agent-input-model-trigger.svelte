<!--
  AgentInputModelTrigger - Pill-shaped button showing the selected model with dropdown caret.

  Visual slice extracted from packages/desktop/src/lib/acp/components/model-selector.trigger.svelte.
  Presentational model trigger label. Composed by AgentInputStandardModelSelector via Selector.
-->
<script lang="ts">
	import { RoundedIcon } from "../icons/index.js";

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
	<RoundedIcon name="chevron-down" class="size-3 text-muted-foreground shrink-0" />
</button>
