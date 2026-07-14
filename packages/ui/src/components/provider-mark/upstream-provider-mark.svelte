<script lang="ts">
import { getUpstreamProviderBrandIconSrc } from "../../lib/provider-brand-icons.js";
import {
	getUpstreamProviderBrandDisplayName,
	type UpstreamProviderBrand,
} from "../../lib/upstream-provider-brand.js";
import { cn } from "../../lib/utils.js";

interface Props {
	/** Upstream provider brand; when null a neutral monogram is derived from `label`. */
	brand?: UpstreamProviderBrand | null;
	label?: string;
	class?: string;
}

let { brand = null, label, class: className = "" }: Props = $props();

const resolvedLabel = $derived(
	label ?? (brand ? getUpstreamProviderBrandDisplayName(brand) : "")
);
const fallbackLetter = $derived(resolvedLabel.charAt(0).toUpperCase() || "?");
</script>

<span
	aria-hidden="true"
	data-upstream-provider-brand={brand ?? "custom"}
	class={cn(
		"inline-flex shrink-0 items-center justify-center grayscale opacity-50 transition-[filter,opacity] duration-150 ease-out hover:grayscale-0 hover:opacity-100 group-hover:grayscale-0 group-hover:opacity-100 group-hover/item:grayscale-0 group-hover/item:opacity-100 group-hover/provider-trigger:grayscale-0 group-hover/provider-trigger:opacity-100 group-hover/provider-tab:grayscale-0 group-hover/provider-tab:opacity-100",
		className
	)}
>
	{#if brand !== null && brand !== "custom"}
		<img src={getUpstreamProviderBrandIconSrc(brand, "light")} alt="" class="size-full object-contain dark:hidden" />
		<img src={getUpstreamProviderBrandIconSrc(brand, "dark")} alt="" class="hidden size-full object-contain dark:block" />
	{:else}
		<span class="font-medium text-[0.625rem] leading-none">{fallbackLetter}</span>
	{/if}
</span>
