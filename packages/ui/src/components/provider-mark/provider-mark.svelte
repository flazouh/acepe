<script lang="ts">
import { getProviderBrandIconSrc } from "../../lib/provider-brand-icons.js";
import { getProviderBrandDisplayName, type ProviderBrand } from "../../lib/provider-brand.js";
import { cn } from "../../lib/utils";

interface Props {
	brand: ProviderBrand;
	label?: string;
	class?: string;
}

let { brand, label, class: className = "" }: Props = $props();

const fallbackLetter = $derived(
	(label ?? getProviderBrandDisplayName(brand)).charAt(0).toUpperCase() || "?"
);
const brandToneClass = $derived.by(() => {
	if (brand === "opencode") {
		return "text-[#f97316]";
	}

	return "text-current";
});
</script>

<span
	aria-hidden="true"
	class={cn(
		"inline-flex shrink-0 items-center justify-center grayscale opacity-50 transition-[filter,opacity] duration-150 ease-out hover:grayscale-0 hover:opacity-100 group-hover:grayscale-0 group-hover:opacity-100 group-hover/item:grayscale-0 group-hover/item:opacity-100 group-hover/provider-trigger:grayscale-0 group-hover/provider-trigger:opacity-100",
		brandToneClass,
		className
	)}
>
	{#if brand !== "custom"}
		<img src={getProviderBrandIconSrc(brand, "light")} alt="" class="size-full object-contain dark:hidden" />
		<img src={getProviderBrandIconSrc(brand, "dark")} alt="" class="hidden size-full object-contain dark:block" />
	{:else}
		<span class="font-medium text-[0.625rem] leading-none">{fallbackLetter}</span>
	{/if}
</span>
