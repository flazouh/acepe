<script lang="ts">
import type { Snippet } from "svelte";

import * as Dialog from "@acepe/ui/dialog";

import type { ToolCall } from "../../types/tool-call.js";

interface ToolContentModalProps {
	/**
	 * Whether the modal is open.
	 */
	isOpen: boolean;

	/**
	 * Callback to close the modal.
	 */
	onClose: () => void;

	/**
	 * The tool call to display.
	 */
	toolCall: ToolCall | null;

	/**
	 * Title snippet for the header.
	 */
	title: Snippet;

	/**
	 * Content snippet.
	 */
	children: Snippet<[{ toolCall: ToolCall }]>;
}

let { isOpen = $bindable(), onClose, toolCall, title, children }: ToolContentModalProps = $props();

// Handle dialog open change - call onClose when dialog closes
function handleOpenChange(open: boolean) {
	isOpen = open;
	if (!open && onClose) {
		onClose();
	}
}
</script>

<Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-[90vw] w-[1200px] max-h-[90vh] flex flex-col p-0 gap-0">
		<Dialog.Header class="px-6 py-4  flex-shrink-0 min-w-0">
			{@render title()}
		</Dialog.Header>

		<div class="flex-1 overflow-y-auto overflow-x-auto px-6 py-4 min-w-0">
			{#if toolCall}
				{@render children({ toolCall })}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
