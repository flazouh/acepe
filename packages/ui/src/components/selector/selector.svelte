<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import { LuChevronDown as ChevronDown } from "../icons/index.js";
	import { mergeProps } from "bits-ui";
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import { Button, type ButtonVariant } from "../button/index.js";
	import { getSelectorTriggerClass, type SelectorTriggerSize } from "./selector-trigger-classes.js";

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
		 * Rich tooltip title (used with tooltipDescription).
		 */
		tooltipTitle?: string;

		/**
		 * Rich tooltip body shown below tooltipTitle.
		 */
		tooltipDescription?: string;

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
		tooltipTitle,
		tooltipDescription,
		tooltipSide = "bottom",
		triggerAriaLabel,
		triggerRef = $bindable(null),
		triggerSize = "default",
		triggerClass: triggerClassOverride = "",
		blockingOverlay = false,
		sideOffset = 4,
		contentClass: menuContentClass = "",
	}: Props = $props();

	const triggerClass = $derived(
		getSelectorTriggerClass({
			triggerSize,
			triggerClass: triggerClassOverride,
		})
	);

	const buttonSize = $derived(
		triggerSize === "chromeIconMd"
			? "chromeIconMd"
			: triggerSize === "chromeIcon"
				? "chromeIcon"
				: triggerSize === "setupChipIcon" || triggerSize === "setupChip"
					? "setupChip"
					: triggerSize === "headerAction"
						? "headerAction"
						: triggerSize === "icon" || triggerSize === "attach"
							? "2xs"
							: "sm"
	);

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
					size={buttonSize}
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
	{#if tooltipLabel || tooltipDescription}
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
									size={buttonSize}
									class={triggerClass}
									{disabled}
									aria-label={triggerAriaLabel ?? tooltipTitle ?? tooltipLabel}
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
			<Tooltip.Content
				side={tooltipSide}
				class={tooltipDescription ? "max-w-[17rem] leading-relaxed font-normal" : undefined}
			>
				{#if tooltipDescription}
					<span class="font-semibold text-foreground">{tooltipTitle ?? tooltipLabel ?? ""}</span>
					<span class="mt-1 block">{tooltipDescription}</span>
				{:else if tooltipLabel}
					{tooltipLabel}
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>
	{:else}
		{@render selectorTrigger()}
	{/if}

	<DropdownMenu.Content {align} {side} {sideOffset} class={contentClass}>
		{@render children()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
