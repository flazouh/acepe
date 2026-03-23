<script lang="ts">
	import { cn } from "../../lib/utils.js";

	interface Props {
		mode: "inline" | "side-by-side";
		onChange: (mode: "inline" | "side-by-side") => void;
		class?: string;
	}

	let { mode, onChange, class: className }: Props = $props();

	const options = [
		{ value: "inline" as const, label: "Inline" },
		{ value: "side-by-side" as const, label: "Split" },
	];
</script>

<div class={cn("inline-flex rounded-full border border-border/50 bg-muted/30 p-0.5", className)}>
	{#each options as option (option.value)}
		<button
			type="button"
			class={cn(
				"rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium transition-all cursor-pointer",
				mode === option.value
					? "bg-background text-foreground shadow-sm"
					: "text-muted-foreground hover:text-foreground"
			)}
			onclick={() => onChange(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>
