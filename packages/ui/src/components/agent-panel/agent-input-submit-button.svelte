<script lang="ts">
import {
	getSubmitButtonAccessibleDescription,
	getSubmitButtonIconName,
	getSubmitButtonTooltipRows,
	type AgentInputSubmitIntent,
} from "./agent-input-submit-button-state.js";
import { agentInputSubmitButtonClass } from "./agent-input-submit-button-variants.js";
import { HugeiconsIcon } from "../icons/index.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

interface Props {
	intent?: AgentInputSubmitIntent;
	disabled?: boolean;
	ariaLabel?: string;
	onSubmit?: () => void;
	stopLabel?: string;
	enterQueueLabel?: string;
	enterQueueDescription?: string;
	enterQueueShortcut?: string;
	enterSteerLabel?: string;
	enterSteerDescription?: string;
	enterSteerShortcut?: string;
}

let {
	intent = "send",
	disabled = false,
	ariaLabel = "Send message",
	onSubmit,
	stopLabel = "Stop",
	enterQueueLabel = "Queue",
	enterQueueDescription = "Runs after the agent finishes its current turn.",
	enterQueueShortcut = "⌘Enter",
	enterSteerLabel = "Steer",
	enterSteerDescription = "Interrupts now and redirects the agent immediately.",
	enterSteerShortcut = "Enter",
}: Props = $props();

const iconName = $derived(getSubmitButtonIconName(intent));
const tooltipRows = $derived(
	getSubmitButtonTooltipRows(intent, {
		stopLabel,
		steerLabel: enterSteerLabel,
		steerDescription: enterSteerDescription,
		steerShortcut: enterSteerShortcut,
		queueLabel: enterQueueLabel,
		queueDescription: enterQueueDescription,
		queueShortcut: enterQueueShortcut,
	})
);
const tooltipDescription = $derived(getSubmitButtonAccessibleDescription(tooltipRows));
</script>

{#snippet submitGlyph()}
	<HugeiconsIcon name={iconName} class="h-4 w-4 shrink-0" />
	<span class="sr-only">{ariaLabel}. {tooltipDescription}</span>
{/snippet}

<Tooltip>
	<TooltipTrigger>
		{#snippet child({ props: triggerProps })}
			{#if disabled}
				<span {...triggerProps} class="inline-flex">
					<button
						data-slot="button"
						data-variant="default"
						data-size="icon"
						data-qa="agent-input-submit"
						type="button"
						onclick={onSubmit}
						disabled={true}
						aria-label={ariaLabel}
						class={agentInputSubmitButtonClass}
					>
						{@render submitGlyph()}
					</button>
				</span>
			{:else}
				<button
					{...triggerProps}
					data-slot="button"
					data-variant="default"
					data-size="icon"
					data-qa="agent-input-submit"
					type="button"
					onclick={onSubmit}
					aria-label={ariaLabel}
					class={agentInputSubmitButtonClass}
				>
					{@render submitGlyph()}
				</button>
			{/if}
		{/snippet}
	</TooltipTrigger>
	<TooltipContent side="top" class="max-w-xs">
		<div class="flex flex-col gap-1.5">
			{#each tooltipRows as row (row.label)}
				<div class="flex flex-col gap-0.5">
					<div class="flex items-center justify-between gap-3">
						<span class="font-medium">{row.label}</span>
						{#if row.shortcut}
							<span class="text-[11px] font-normal text-muted-foreground">{row.shortcut}</span>
						{/if}
					</div>
					{#if row.description}
						<span class="text-[11px] font-normal leading-snug text-muted-foreground">
							{row.description}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</TooltipContent>
</Tooltip>
