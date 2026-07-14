<script lang="ts">
	import { ProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		providerBrand: ProviderBrand | null;
		providerName: string;
		initials: string;
		class?: string;
	}

	let {
		providerBrand,
		providerName,
		initials,
		class: className = "",
	}: Props = $props();

	const fallbackLabel = $derived.by(() => {
		const compactInitials = initials.trim().replace(/[^a-zA-Z0-9]/g, "");
		if (compactInitials.length >= 1) {
			return compactInitials.slice(0, 2).toUpperCase();
		}

		const compactName = providerName.trim().replace(/[^a-zA-Z0-9]/g, "");
		if (compactName.length >= 1) {
			return compactName.slice(0, 2).toUpperCase();
		}

		return "AI";
	});
</script>

<span
	class={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}
	aria-hidden="true"
	data-usage-agent-icon
>
	{#if providerBrand !== null}
		<ProviderMark
			brand={providerBrand}
			label={providerName}
			class="size-full opacity-90 grayscale-0"
		/>
	{:else}
		<span
			class="flex size-full items-center justify-center rounded-sm font-mono text-[8px] font-semibold leading-none text-muted-foreground"
		>
			{fallbackLabel}
		</span>
	{/if}
</span>
