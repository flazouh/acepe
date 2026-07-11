<script lang="ts">
import {
	ANTHROPIC_ICON_DARK_SRC,
	ANTHROPIC_ICON_LIGHT_SRC,
} from "../../lib/provider-brand-icons.js";
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
	{#if brand === "anthropic"}
		<img src={ANTHROPIC_ICON_LIGHT_SRC} alt="" class="size-full object-contain dark:hidden" />
		<img
			src={ANTHROPIC_ICON_DARK_SRC}
			alt=""
			class="hidden size-full object-contain dark:block"
		/>
	{:else if brand === "githubCopilot"}
		<img src="/svgs/icons/copilot_light.svg" alt="" class="size-full object-contain dark:hidden" />
		<img src="/svgs/icons/copilot.svg" alt="" class="hidden size-full object-contain dark:block" />
	{:else if brand === "openAi"}
		<img
			src="/svgs/agents/codex/openai-icon-light.svg"
			alt=""
			class="size-full object-contain dark:hidden"
		/>
		<img
			src="/svgs/agents/codex/openai-icon-dark.svg"
			alt=""
			class="hidden size-full object-contain dark:block"
		/>
	{:else if brand === "openRouter"}
		<svg viewBox="0 0 512 512" fill="currentColor" stroke="currentColor" class="size-full" aria-hidden="true">
			<path d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945" stroke-width="90" fill="none" />
			<path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" />
			<path d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377" stroke-width="90" fill="none" />
			<path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" />
		</svg>
	{:else}
		<span class="font-medium text-[0.625rem] leading-none">{fallbackLetter}</span>
	{/if}
</span>
