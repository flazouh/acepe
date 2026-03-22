<script lang="ts">
import { ChevronDown } from "@lucide/svelte/icons";
import { Button } from "$lib/components/ui/button/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { AskMessage } from "../../types/ask-message.js";

import MessageInputContainer from "../message-input-container.svelte";

let {
	message,
	onSelectOption,
}: {
	message: AskMessage;
	onSelectOption?: (optionId: string) => void;
} = $props();

let selectedId = $state<string | null>(null);

function handleSelectOption(optionId: string) {
	selectedId = optionId;
	onSelectOption?.(optionId);
}

// Handle keyboard shortcuts (Alt+1, Alt+2, etc.)
function handleKeydown(e: KeyboardEvent) {
	if (!e.altKey) return;

	const key = e.key;
	// Check if it's a number key
	if (/^\d$/.test(key)) {
		const index = parseInt(key, 10) - 1; // Alt+1 = index 0
		if (index >= 0 && index < message.options.length) {
			e.preventDefault();
			const option = message.options[index];
			handleSelectOption(option.id);
		}
	}
}
</script>

<!-- Global keyboard listener for Alt+number shortcuts -->
<svelte:window on:keydown={handleKeydown} />

<div class="space-y-3">
	<MessageInputContainer class="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
		<div class="space-y-2">
			<div class="font-semibold text-sm text-foreground">{message.question}</div>
			{#if message.description}
				<div class="text-xs text-muted-foreground">{message.description}</div>
			{/if}
		</div>
	</MessageInputContainer>

	<div class="grid gap-2 pl-4">
		{#each message.options as option, index (option.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant={selectedId === option.id ? "default" : "outline"}
						class="justify-start text-left h-auto py-2"
						onclick={() => handleSelectOption(option.id)}
					>
						<span class="text-xs text-muted-foreground mr-2 min-w-5">
							Alt+{index + 1}
						</span>
						<span class="flex-1">
							<div class="font-medium text-sm">{option.label}</div>
							{#if option.description}
								<div class="text-xs text-muted-foreground mt-0.5">
									{option.description}
								</div>
							{/if}
						</span>
						{#if selectedId === option.id}
							<ChevronDown class="h-4 w-4 ml-2 flex-shrink-0" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					Alt+{index + 1}: {option.label}
				</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</div>
</div>
