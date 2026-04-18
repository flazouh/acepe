<script lang="ts">
import { IconSend } from "@tabler/icons-svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Textarea } from "$lib/components/ui/textarea/index.js";
import type { ContentBlock } from "../../services/converted-session-types.js";

let {
	onSend,
	isLoading = false,
	disabled = false,
}: {
	onSend: (content: ContentBlock[]) => void | Promise<void>;
	isLoading?: boolean;
	disabled?: boolean;
} = $props();

let message = $state("");
let textareaRef: HTMLTextAreaElement | null = $state(null);

async function handleSend() {
	if (!message.trim() || isLoading || disabled) {
		return;
	}

	const content: ContentBlock[] = [
		{
			type: "text",
			text: message.trim(),
		},
	];

	await onSend(content);
	message = "";

	// Focus textarea after sending
	if (textareaRef) {
		textareaRef.focus();
	}
}

function handleKeyDown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		handleSend();
	}
}
</script>

<div class="flex items-end gap-2 p-4 border-t">
	<Textarea
		bind:ref={textareaRef}
		bind:value={message}
		onkeydown={handleKeyDown}
		placeholder={"Type your message... (Enter to send, Shift+Enter for newline)"}
		disabled={isLoading || disabled}
		class="min-h-[60px] max-h-[200px] resize-none"
		rows={3}
	/>
	<Button
		onclick={handleSend}
		disabled={!message.trim() || isLoading || disabled}
		size="icon"
		class="h-[60px] w-[60px] shrink-0"
	>
		{#if isLoading}
			<Spinner class="h-5 w-5" />
		{:else}
			<IconSend class="h-5 w-5" />
		{/if}
	</Button>
</div>
