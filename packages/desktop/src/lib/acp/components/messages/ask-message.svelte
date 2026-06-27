<script lang="ts">
import { ChevronDown } from "@acepe/ui/icons";
import { Button } from "$lib/components/ui/button/index.js";
import * as Tooltip from "@acepe/ui/tooltip";

import type { AskMessage } from "../../types/ask-message.js";

import MessageInputContainer from "../message-input-container.svelte";
import {
	buildAskMessageDisplayState,
	getAskOptionIdFromKeyboardShortcut,
} from "./ask-message-state.js";

let {
	message,
	onSelectOption,
}: {
	message: AskMessage;
	onSelectOption?: (optionId: string) => void;
} = $props();

let selectedId = $state<string | null>(null);
const messageState = $derived(buildAskMessageDisplayState({ message, selectedId }));

function handleSelectOption(optionId: string) {
	selectedId = optionId;
	onSelectOption?.(optionId);
}

function handleKeydown(e: KeyboardEvent) {
	const optionId = getAskOptionIdFromKeyboardShortcut(e, message.options);
	if (optionId) {
		e.preventDefault();
		handleSelectOption(optionId);
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
		{#each messageState.options as optionView (optionView.option.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant={optionView.isSelected ? "default" : "outline"}
						class="justify-start text-left h-auto py-2"
						onclick={() => handleSelectOption(optionView.option.id)}
					>
						<span class="text-xs text-muted-foreground mr-2 min-w-5">
							{optionView.shortcutLabel}
						</span>
						<span class="flex-1">
							<div class="font-medium text-sm">{optionView.option.label}</div>
							{#if optionView.option.description}
								<div class="text-xs text-muted-foreground mt-0.5">
									{optionView.option.description}
								</div>
							{/if}
						</span>
						{#if optionView.isSelected}
							<ChevronDown class="h-4 w-4 ml-2 flex-shrink-0" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					{optionView.shortcutLabel}: {optionView.option.label}
				</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</div>
</div>
