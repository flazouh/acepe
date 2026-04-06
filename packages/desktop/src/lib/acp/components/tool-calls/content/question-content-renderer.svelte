<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import IconCircle from "@tabler/icons-svelte/icons/circle";
import IconHelpCircleFilled from "@tabler/icons-svelte/icons/help-circle-filled";
import IconSquare from "@tabler/icons-svelte/icons/square";
import { Kbd } from "@acepe/ui/kbd";

import type { QuestionContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: QuestionContent;
}

let { content }: Props = $props();

// Color palette for options from project palette
const OPTION_COLORS = ["var(--success)", Colors.red, Colors.pink, Colors.orange];

function getOptionColor(index: number): string {
	return OPTION_COLORS[index % OPTION_COLORS.length];
}

// Get the first question for primary display
const primaryQuestion = $derived(content.questions[0]);
const isMultiSelect = $derived(primaryQuestion?.multiSelect ?? false);
</script>

<div class="space-y-3">
	{#each content.questions as question (question.question)}
		<div class="rounded-md border bg-card p-3">
			<!-- Question header -->
			<div class="flex items-center gap-1.5 text-xs mb-2">
				<IconHelpCircleFilled class="h-3.5 w-3.5 text-primary shrink-0" />
				<span class="font-medium text-muted-foreground">Question</span>
				{#if question.header}
					<span class="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
						{question.header}
					</span>
				{/if}
			</div>

			<!-- Question text -->
			<div class="text-sm text-foreground mb-3">
				{question.question}
			</div>

			<!-- Options -->
			{#if question.options && question.options.length > 0}
				<div class="space-y-1.5">
					{#each question.options as option, optIdx (option.label)}
						<div
							class="relative flex items-center gap-2 px-2 py-2 rounded-sm border bg-input/30 cursor-pointer hover:bg-input/50 transition-colors overflow-hidden"
							role="button"
							tabindex="0"
						>
							<!-- Colored left indicator -->
							<div
								class="absolute left-0 top-0 bottom-0 w-1"
								style="background-color: {getOptionColor(optIdx)};"
							></div>

							<!-- Content with padding for left indicator -->
							<div class="flex items-start gap-2 pl-1 w-full">
								{#if isMultiSelect}
									<IconSquare class="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
								{:else}
									<IconCircle class="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
								{/if}
								<Kbd class="shrink-0 mt-0.5">{optIdx + 1}</Kbd>
								<div class="flex flex-col min-w-0">
									<span class="text-xs text-foreground">
										{option.label}
									</span>
									{#if option.description}
										<span class="text-xs text-muted-foreground mt-0.5">
											{option.description}
										</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>
