<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { mergeProps } from "bits-ui";
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import { Button, type ButtonVariant } from "../button/index.js";

	type SelectorTriggerSize = "default" | "icon" | "square" | "attach" | "minimal" | "pill" | "footer";

	interface Props {
		/**
		 * Content for the label button (left side of the ButtonGroup).
		 */
		renderButton: Snippet;

		/**
		 * Content for the dropdown. Rendered inside DropdownMenu.Content.
		 */
		children: Snippet;

		/**
		 * Whether the dropdown is open. Bindable.
		 */
		open?: boolean;

		/**
		 * Whether the selector is disabled.
		 */
		disabled?: boolean;

		/**
		 * Dropdown content alignment relative to the trigger.
		 */
		align?: "start" | "center" | "end";

		/**
		 * Dropdown content side relative to the trigger.
		 */
		side?: "top" | "right" | "bottom" | "left";

		/**
		 * CSS class for the root container.
		 */
		class?: string;

		/**
		 * Button variant for the selector button.
		 */
		variant?: ButtonVariant;

		/**
		 * Callback when open state changes.
		 */
		onOpenChange?: (isOpen: boolean) => void;

		/**
		 * Whether to render the trigger chevron.
		 */
		showChevron?: boolean;

		/**
		 * Optional tooltip shown on trigger hover.
		 */
		tooltipLabel?: string;

		/**
		 * Tooltip side relative to the trigger.
		 */
		tooltipSide?: "top" | "right" | "bottom" | "left";

		/**
		 * Accessible label for the trigger button.
		 */
		triggerAriaLabel?: string;

		/**
		 * Bindable reference to the trigger button element.
		 */
		triggerRef?: HTMLButtonElement | null;

		/**
		 * Preset trigger sizing and shape.
		 */
		triggerSize?: SelectorTriggerSize;

		/**
		 * Extra classes merged onto the trigger button (after preset triggerSize classes).
		 */
		triggerClass?: string;

		/**
		 * Raise dropdown content above blocking overlays (branch picker, etc.).
		 */
		blockingOverlay?: boolean;

		/**
		 * Distance between trigger and dropdown content.
		 */
		sideOffset?: number;

		/**
		 * Extra classes merged onto dropdown menu content.
		 */
		contentClass?: string;
	}

	let {
		renderButton,
		children,
		open = $bindable(false),
		disabled = false,
		align = "end",
		side,
		class: className,
		variant = "outline",
		onOpenChange,
		showChevron = true,
		tooltipLabel,
		tooltipSide = "bottom",
		triggerAriaLabel,
		triggerRef = $bindable(null),
		triggerSize = "default",
		triggerClass: triggerClassOverride = "",
		blockingOverlay = false,
		sideOffset = 4,
		contentClass: menuContentClass = "",
	}: Props = $props();

	const triggerClass = $derived.by(() => {
		const sizeClass = (() => {
			switch (triggerSize) {
			case "icon":
				return "size-5 min-w-0 shrink-0 rounded-md gap-0 p-0 text-muted-foreground hover:bg-accent hover:text-foreground";
			case "square":
				return "h-7 w-7 shrink-0 rounded-none border-0 p-0 gap-0 text-muted-foreground hover:bg-muted/80 hover:text-foreground";
			case "attach":
				return "size-5 min-w-0 shrink-0 rounded-md gap-0 !p-0";
			case "minimal":
				return "!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius] gap-1.5 px-2 text-[11px]";
			case "pill":
				return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-md border-0 px-2.5 text-[11px]";
			case "footer":
				return "h-5 min-w-0 shrink-0 gap-1 rounded-md border-0 !px-1 has-[>svg]:!px-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3";
			default:
				return "gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-none border-0 px-2 text-[11px]";
			}
		})();
		return cn(sizeClass, triggerClassOverride);
	});

	const contentClass = $derived(
		cn(
			"w-fit max-w-[280px]",
			blockingOverlay && "z-[var(--app-blocking-z)] isolate",
			menuContentClass
		)
	);

	export function toggle() {
		open = !open;
		onOpenChange?.(open);
	}
</script>

{#snippet selectorTrigger()}
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<div role="group" class={cn("flex w-fit items-stretch", className)}>
				<Button
					{...props}
					bind:ref={triggerRef}
					{variant}
					size="sm"
					class={triggerClass}
					{disabled}
					aria-label={triggerAriaLabel}
				>
					{@render renderButton()}
					{#if showChevron}
						<ChevronDown
							class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 {open
								? 'rotate-180'
								: ''}"
						/>
					{/if}
				</Button>
			</div>
		{/snippet}
	</DropdownMenu.Trigger>
{/snippet}

<DropdownMenu.Root bind:open {onOpenChange}>
	{#if tooltipLabel}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: tooltipProps })}
					<DropdownMenu.Trigger>
						{#snippet child({ props: dropdownProps })}
							{@const props = mergeProps(tooltipProps, dropdownProps)}
							<div role="group" class={cn("flex w-fit items-stretch", className)}>
								<Button
									{...props}
									bind:ref={triggerRef}
									{variant}
									size="sm"
									class={triggerClass}
									{disabled}
									aria-label={triggerAriaLabel ?? tooltipLabel}
								>
									{@render renderButton()}
									{#if showChevron}
										<ChevronDown
											class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 {open
												? 'rotate-180'
												: ''}"
										/>
									{/if}
								</Button>
							</div>
						{/snippet}
					</DropdownMenu.Trigger>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side={tooltipSide}>{tooltipLabel}</Tooltip.Content>
		</Tooltip.Root>
	{:else}
		{@render selectorTrigger()}
	{/if}

	<DropdownMenu.Content {align} {side} {sideOffset} class={contentClass}>
		{@render children()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
