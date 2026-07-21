<script lang="ts">
import type { AgentInputSubmitIntent } from "./agent-input-editor.svelte";
import type { AgentInputEnterBehavior } from "./agent-input-enter-behavior.js";
import {
	agentInputSubmitGroupDisabledVariants,
	agentInputSubmitMenuSegmentClass,
	agentInputSubmitPrimarySegmentVariants,
	agentInputSubmitStandaloneDisabledClass,
} from "./agent-input-submit-button-variants.js";
import { ButtonGroup } from "../button-group/index.js";
import * as DropdownMenu from "../dropdown-menu/index.js";
import { HugeiconsIcon } from "../icons/index.js";
import { Selector } from "../selector/index.js";
import { cn } from "../../lib/utils.js";

interface Props {
	intent?: AgentInputSubmitIntent;
	disabled?: boolean;
	ariaLabel?: string;
	onSubmit?: () => void;
	enterBehavior?: AgentInputEnterBehavior;
	enterBehaviorMenuLabel?: string;
	enterQueueLabel?: string;
	enterQueueDescription?: string;
	enterSteerLabel?: string;
	enterSteerDescription?: string;
	onEnterBehaviorChange?: (behavior: AgentInputEnterBehavior) => void;
}

interface EnterBehaviorOption {
	value: AgentInputEnterBehavior;
	label: string;
	description: string;
}

let {
	intent = "send",
	disabled = false,
	ariaLabel = "Send message",
	onSubmit,
	enterBehavior = "queue",
	enterBehaviorMenuLabel = "Enter behavior",
	enterQueueLabel = "Queue",
	enterQueueDescription = "Runs after the agent finishes its current turn.",
	enterSteerLabel = "Steer",
	enterSteerDescription = "Interrupts now and redirects the agent immediately.",
	onEnterBehaviorChange,
}: Props = $props();

const showStop = $derived(intent === "stop" || intent === "steer");
const showEnterBehaviorMenu = $derived(onEnterBehaviorChange !== undefined);
const behaviorOptions = $derived<EnterBehaviorOption[]>([
	{
		value: "queue",
		label: enterQueueLabel,
		description: enterQueueDescription,
	},
	{
		value: "steer",
		label: enterSteerLabel,
		description: enterSteerDescription,
	},
]);
const submitButtonClass = $derived(
	cn(
		agentInputSubmitPrimarySegmentVariants({ split: showEnterBehaviorMenu }),
		showEnterBehaviorMenu ? undefined : agentInputSubmitStandaloneDisabledClass
	)
);
const buttonGroupClass = $derived(
	cn(
		"h-7 !rounded-lg [&>[data-slot=button]:first-child]:!rounded-l-lg [&>:first-child_[data-slot=button]]:!rounded-l-lg",
		agentInputSubmitGroupDisabledVariants({ disabled })
	)
);

function handleEnterBehaviorChange(value: string): void {
	if (value === "queue" || value === "steer") {
		onEnterBehaviorChange?.(value);
	}
}
</script>

{#snippet submitIcon()}
	{#if showStop}
		<HugeiconsIcon name="stop" class="h-4 w-4 shrink-0" />
	{:else}
		<HugeiconsIcon name="arrow-up" class="h-4 w-4 shrink-0" />
	{/if}
	<span class="sr-only">{ariaLabel}</span>
{/snippet}

{#snippet submitButton()}
	<button
		data-slot="button"
		data-variant="default"
		data-size="icon"
		type="button"
		onclick={onSubmit}
		{disabled}
		aria-label={ariaLabel}
		class={submitButtonClass}
	>
		{@render submitIcon()}
	</button>
{/snippet}

{#if showEnterBehaviorMenu}
	<ButtonGroup class={buttonGroupClass}>
		{@render submitButton()}
		<Selector
			variant="ghost"
			align="end"
			side="top"
			sideOffset={8}
			showChevron={false}
			embeddedInGroup={true}
			triggerIcon="dots"
			triggerAriaLabel={enterBehaviorMenuLabel}
			triggerClass={agentInputSubmitMenuSegmentClass}
			contentClass="w-64 p-1"
		>
			{#snippet renderButton()}{/snippet}
			<DropdownMenu.RadioGroup value={enterBehavior} onValueChange={handleEnterBehaviorChange}>
				{#each behaviorOptions as option (option.value)}
					<DropdownMenu.RadioItem
						value={option.value}
						hideIndicator={true}
						class="flex-col items-stretch gap-0.5 !ps-2 py-1.5 pe-2 text-left data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
					>
						{#snippet children({ checked })}
							<div class="flex min-w-0 items-center justify-between gap-2">
								<span class="truncate text-xs font-medium">{option.label}</span>
								<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
									{#if checked}
										<HugeiconsIcon name="check" class="h-3.5 w-3.5" />
									{/if}
								</span>
							</div>
							<span class="text-[11px] leading-snug text-muted-foreground">{option.description}</span>
						{/snippet}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</Selector>
	</ButtonGroup>
{:else}
	{@render submitButton()}
{/if}
