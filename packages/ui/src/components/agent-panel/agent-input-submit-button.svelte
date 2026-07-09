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
		<svg
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
			viewBox="0 0 20 20"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z"
				fill="currentColor"
			/>
		</svg>
	{:else}
		<svg
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
			viewBox="0 0 20 20"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z"
				fill="currentColor"
			/>
		</svg>
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
