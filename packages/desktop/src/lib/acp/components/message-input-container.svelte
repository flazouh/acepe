<script lang="ts">
import type { Snippet } from "svelte";
import { UserMessageContainer } from "@acepe/ui/user-message-container";
import MessageMetaPill from "./messages/message-meta-pill.svelte";

let {
	class: className = "",
	timestamp,
	children,
}: { class?: string; timestamp?: Date | string | number; children: Snippet } = $props();

let contentRef: HTMLDivElement | null = $state(null);
</script>

<UserMessageContainer class="w-full !p-0.5 {className}" contentClass="p-1.5">
	{#snippet content()}
		<div class="group/copy relative">
			<div
				bind:this={contentRef}
				class="text-foreground text-sm leading-relaxed break-words overflow-hidden"
			>
				{@render children()}
			</div>
			<div
				class="absolute bottom-0 right-0 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pointer-events-none group-hover/copy:pointer-events-auto"
			>
				<MessageMetaPill
					getText={() => contentRef?.textContent ?? ""}
					{timestamp}
					variant="user"
					class="rounded-md bg-background/80 px-1 py-0.5 shadow-sm backdrop-blur-sm"
				/>
			</div>
		</div>
	{/snippet}
</UserMessageContainer>
