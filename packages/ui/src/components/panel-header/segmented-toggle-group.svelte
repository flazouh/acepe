<script lang="ts">
	import type { Snippet } from "svelte";

	interface SegmentedToggleItem {
		readonly id: string;
		readonly label: string;
		readonly disabled?: boolean;
	}

	interface Props {
		items: readonly SegmentedToggleItem[];
		value: string;
		onChange: (id: string) => void;
		class?: string;
		itemClass?: string;
		itemContent?: Snippet<[SegmentedToggleItem]>;
	}

	let {
		items,
		value,
		onChange,
		class: className = "",
		itemClass = "",
		itemContent,
	}: Props = $props();
</script>

<div class="w-fit flex items-center rounded-md border border-border overflow-hidden bg-background/50 {className}" role="radiogroup">
	{#each items as item (item.id)}
		<button
			type="button"
			role="radio"
			aria-checked={value === item.id}
			disabled={item.disabled}
			onclick={() => onChange(item.id)}
			class="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none {value ===
			item.id
				? 'bg-foreground/15 text-foreground'
				: 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5'} {itemClass}"
			data-header-control
		>
			{#if itemContent}
				{@render itemContent(item)}
			{:else}
				<span>{item.label}</span>
			{/if}
		</button>
	{/each}
</div>
