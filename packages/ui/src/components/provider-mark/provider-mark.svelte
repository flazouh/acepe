<script lang="ts">
	import { IconBrandGoogle } from "@tabler/icons-svelte";
	import anthropicLogo from "./anthropic-official.png?url";

	import { getProviderDisplayName, resolveProviderBrand } from "../../lib/provider-brand.js";
	import { cn } from "../../lib/utils";

	interface Props {
		provider: string;
		class?: string;
	}

	let { provider, class: className = "" }: Props = $props();

	const brand = $derived(resolveProviderBrand(provider));
	const fallbackLetter = $derived(getProviderDisplayName(provider).charAt(0).toUpperCase() || "?");
	const brandToneClass = $derived.by(() => {
		if (brand === "google") {
			return "text-[#4285f4]";
		}

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
		brand === "default" && "hidden",
		brandToneClass,
		className
	)}
>
	{#if brand === "anthropic"}
		<img src={anthropicLogo} alt="" class="size-full object-contain dark:invert" />
	{:else if brand === "openai"}
		<img
			src="/svgs/agents/codex/codex-icon-light.svg"
			alt=""
			class="size-full object-contain dark:hidden"
		/>
		<img
			src="/svgs/agents/codex/codex-icon-dark.svg"
			alt=""
			class="hidden size-full object-contain dark:block"
		/>
	{:else if brand === "google"}
		<IconBrandGoogle class="size-full" stroke={1.8} />
	{:else if brand === "opencode"}
		<svg viewBox="0 0 16 16" fill="none" class="size-full" xmlns="http://www.w3.org/2000/svg">
			<path
				d="m5.5 4.25-3 3 3 3"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				d="M8.25 10.25h5.25"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		</svg>
	{:else if brand === "cursor"}
		<img
			src="/svgs/agents/cursor/cursor-icon-light.svg"
			alt=""
			class="size-full object-contain dark:hidden"
		/>
		<img
			src="/svgs/agents/cursor/cursor-icon-dark.svg"
			alt=""
			class="hidden size-full object-contain dark:block"
		/>
	{:else}
		<span class="font-medium text-[0.625rem] leading-none">{fallbackLetter}</span>
	{/if}
</span>
