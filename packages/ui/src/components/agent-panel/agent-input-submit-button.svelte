<script lang="ts">
import {
	getSubmitButtonAccessibleDescription,
	getSubmitButtonIconName,
	getSubmitButtonTooltipRows,
	type AgentInputSubmitIntent,
} from "./agent-input-submit-button-state.js";
import { agentInputSubmitButtonClass } from "./agent-input-submit-button-variants.js";
import { HugeiconsIcon } from "../icons/index.js";
import { Kbd, KbdGroup } from "../kbd/index.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";

interface Props {
	intent?: AgentInputSubmitIntent;
	disabled?: boolean;
	ariaLabel?: string;
	onSubmit?: () => void;
	stopLabel?: string;
	enterQueueLabel?: string;
	enterQueueShortcut?: readonly string[];
	enterSteerLabel?: string;
	enterSteerShortcut?: readonly string[];
}

let {
	intent = "send",
	disabled = false,
	ariaLabel = "Send message",
	onSubmit,
	stopLabel = "Stop",
	enterQueueLabel = "Queue",
	enterQueueShortcut = ["⌘", "Enter"],
	enterSteerLabel = "Steer",
	enterSteerShortcut = ["Enter"],
}: Props = $props();

const iconName = $derived(getSubmitButtonIconName(intent));
const tooltipRows = $derived(
	getSubmitButtonTooltipRows(intent, {
		stopLabel,
		steerLabel: enterSteerLabel,
		steerShortcut: enterSteerShortcut,
		queueLabel: enterQueueLabel,
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
	<TooltipContent side="top">
		<div class="flex flex-col gap-1.5">
			{#each tooltipRows as row (row.label)}
				<div class="flex items-center justify-between gap-3">
					<span class="font-medium">{row.label}</span>
					{#if row.shortcut.length > 0}
						<KbdGroup>
							{#each row.shortcut as key, index (key + String(index))}
								<Kbd>{key}</Kbd>
							{/each}
						</KbdGroup>
					{/if}
				</div>
			{/each}
		</div>
	</TooltipContent>
</Tooltip>
