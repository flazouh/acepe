<script lang="ts">
	import { LuChevronDown as ChevronDown } from "../icons/index.js";
	import type { Snippet } from "svelte";
	import { WarningCircle } from "../icons/index.js";

	import { LoadingIcon } from "../icons/index.js";

	interface Props {
		visible: boolean;
		title: string;
		summary: string;
		details: string;
		progressLabel?: string | null;
		tone?: "running" | "error";
		leading?: Snippet;
	}

	let {
		visible,
		title,
		summary,
		details,
		progressLabel = null,
		tone = "running",
		leading,
	}: Props = $props();

	let isExpanded = $state(true);

	const detailsText = $derived(details.length > 0 ? details : summary);

	function toggleExpanded(): void {
		isExpanded = !isExpanded;
	}
</script>

{#if visible}
	<div class="w-full">
		{#if isExpanded}
			<div class="overflow-hidden rounded-t-2xl border border-b-0 border-border bg-input/30">
				<div class="max-h-[240px] overflow-y-auto px-3 py-2">
					<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{detailsText}</pre>
				</div>
			</div>
		{/if}

		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleExpanded();
				}
			}}
			class="w-full flex cursor-pointer items-center justify-between rounded-2xl bg-input/30 px-3 py-1 {isExpanded
				? 'rounded-t-none'
				: ''}"
			aria-expanded={isExpanded}
		>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				{#if leading}
					{@render leading()}
				{:else if tone === "error"}
					<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
				{:else}
					<LoadingIcon class="shrink-0 text-muted-foreground" size={13} aria-label="Loading" />
				{/if}

				<span class="font-medium text-foreground shrink-0">{title}</span>

				<span class="truncate text-muted-foreground">
					{summary}
				</span>
			</div>

			<div class="flex items-center gap-2 shrink-0">
				{#if progressLabel}
					<span class="tabular-nums text-muted-foreground text-[0.6875rem]">
						{progressLabel}
					</span>
				{/if}
				<ChevronDown
					class="size-3.5 text-muted-foreground transition-transform duration-200 {isExpanded
						? 'rotate-180'
						: ''}"
				/>
			</div>
		</div>
	</div>
{/if}
