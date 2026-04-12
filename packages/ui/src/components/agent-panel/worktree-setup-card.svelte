<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";
	import { WarningCircle } from "phosphor-svelte";

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
			<div class="rounded-t-lg bg-accent overflow-hidden">
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
			class="w-full flex items-center justify-between px-3 py-1 rounded-lg bg-accent hover:bg-accent/80 transition-colors cursor-pointer {isExpanded
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
					<div
						class="size-[13px] rounded-full border-2 border-muted-foreground/30 border-t-foreground/70 animate-spin shrink-0"
					></div>
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
