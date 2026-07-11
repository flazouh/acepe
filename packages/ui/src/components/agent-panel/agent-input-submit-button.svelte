<script lang="ts">
import type { AgentInputSubmitIntent } from "./agent-input-editor.svelte";
import type { AgentInputEnterBehavior } from "./agent-input-enter-behavior.js";
import { ButtonGroup } from "../button-group/index.js";
import * as DropdownMenu from "../dropdown-menu/index.js";
import { RoundedIcon } from "../icons/index.js";

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
	enterBehaviorMenuMuted?: boolean;
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
	enterBehaviorMenuMuted = false,
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
	showEnterBehaviorMenu
		? "inline-flex h-7 w-7 cursor-pointer shrink-0 items-center justify-center gap-0 whitespace-nowrap rounded-l-lg rounded-r-none bg-foreground p-0 text-sm font-medium text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
		: "inline-flex h-7 w-7 cursor-pointer shrink-0 items-center justify-center gap-0 whitespace-nowrap rounded-lg bg-foreground p-0 text-sm font-medium text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
);
const enterBehaviorMenuTriggerClass = $derived(
	`inline-flex h-7 w-5 shrink-0 items-center justify-center rounded-l-none rounded-r-lg border-l border-background/20 bg-foreground p-0 text-background transition-all outline-none hover:bg-foreground/85 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${enterBehaviorMenuMuted ? "opacity-50" : ""}`
);

function handleEnterBehaviorChange(value: string): void {
	if (value === "queue" || value === "steer") {
		onEnterBehaviorChange?.(value);
	}
}
</script>

{#snippet submitIcon()}
	{#if showStop}
		<RoundedIcon name="stop" class="h-4 w-4 shrink-0" />
	{:else}
		<RoundedIcon name="arrow-up" class="h-4 w-4 shrink-0" />
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
	<ButtonGroup
		class="h-7 !rounded-lg [&>[data-slot=button]:first-child]:!rounded-l-lg [&>:first-child_[data-slot=button]]:!rounded-l-lg"
	>
		{@render submitButton()}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				aria-label={enterBehaviorMenuLabel}
				class={enterBehaviorMenuTriggerClass}
			>
				<RoundedIcon name="more" class="h-4 w-4 rotate-90" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="end" sideOffset={8} class="w-64 p-1">
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
											<RoundedIcon name="check" class="h-3.5 w-3.5" />
										{/if}
									</span>
								</div>
								<span class="text-[11px] leading-snug text-muted-foreground">{option.description}</span>
							{/snippet}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</ButtonGroup>
{:else}
	{@render submitButton()}
{/if}
