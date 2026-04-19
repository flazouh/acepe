<script lang="ts">
	import { BellSimple } from "phosphor-svelte";

	interface Props {
		queueCount: number;
		label: string;
		/** When omitted, the row is rendered as a visual-only div (no click affordance). */
		onOpen?: () => void;
	}

	let { queueCount, label, onOpen }: Props = $props();

	const baseClass =
		"flex h-8 w-full items-center justify-between gap-2 rounded bg-card/50 px-2 text-muted-foreground transition-colors";
	const interactiveClass = "hover:bg-accent/50 hover:text-foreground";
</script>

{#if onOpen}
	<button
		type="button"
		class="{baseClass} {interactiveClass}"
		onclick={onOpen}
		aria-label={label}
		title={label}
	>
		<div class="flex items-center gap-1.5 min-w-0">
			<BellSimple size={12} weight="fill" class="text-primary shrink-0" />
			<span class="text-[11px] font-medium truncate">{label}</span>
		</div>
		<span
			class="min-w-[16px] rounded-full border border-background bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground"
		>
			{queueCount}
		</span>
	</button>
{:else}
	<div class={baseClass} aria-label={label} title={label}>
		<div class="flex items-center gap-1.5 min-w-0">
			<BellSimple size={12} weight="fill" class="text-primary shrink-0" />
			<span class="text-[11px] font-medium truncate">{label}</span>
		</div>
		<span
			class="min-w-[16px] rounded-full border border-background bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground"
		>
			{queueCount}
		</span>
	</div>
{/if}
