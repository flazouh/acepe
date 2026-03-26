<script lang="ts">
import type { Snippet } from "svelte";
import { InputContainer } from "@acepe/ui/input-container";
import CopyButton from "./messages/copy-button.svelte";

let { class: className = "", children }: { class?: string; children: Snippet } = $props();

let contentRef: HTMLDivElement | null = $state(null);
</script>

<InputContainer class="w-full !p-0.5 {className}" contentClass="p-1.5">
	{#snippet content()}
		<div class="group/copy flex items-start gap-2">
			<div
				bind:this={contentRef}
				class="text-foreground text-sm leading-relaxed break-words overflow-hidden flex-1"
			>
				{@render children()}
			</div>
			<CopyButton
				getText={() => contentRef?.textContent ?? ""}
				variant="inline"
				class="opacity-0 group-hover/copy:opacity-100 transition-opacity"
			/>
		</div>
	{/snippet}
</InputContainer>
