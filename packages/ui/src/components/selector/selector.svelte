<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import { mergeProps } from "bits-ui";
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import { Button, type ButtonVariant, buttonVariants } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { OVERFLOW_DOTS_ICON_CLASS } from "../panel-header/project-card-action-button-class.js";
	import {
		getSelectorTriggerButtonPropsForContext,
		getSelectorTriggerClass,
		resolveSelectorTriggerSize,
		type SelectorTriggerSize,
	} from "./selector-trigger-classes.js";

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
		 * When true, marks the trigger for fused button-group segment styling.
		 */
		embeddedInGroup?: boolean;

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

		/**
		 * When true, applies the trigger button's active visual state (open menu).
		 */
		triggerActive?: boolean;

		/**
		 * Preset overflow trigger glyph. When set, renders instead of renderButton.
		 */
		triggerIcon?: "none" | "dots" | "gear";
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
		embeddedInGroup = false,
		blockingOverlay = false,
		sideOffset = 4,
		contentClass: menuContentClass = "",
		triggerActive = false,
		triggerIcon = "none",
	}: Props = $props();

	const resolvedTriggerSize = $derived(resolveSelectorTriggerSize(triggerSize));

	const triggerButtonProps = $derived(
		getSelectorTriggerButtonPropsForContext({
			triggerSize,
			embeddedInGroup,
			variant,
		})
	);

	const triggerClass = $derived(
		getSelectorTriggerClass({
			triggerSize,
			triggerClass: triggerClassOverride,
		})
	);

	const resolvedTriggerAriaLabel = $derived(
		triggerAriaLabel ?? tooltipTitle ?? tooltipLabel
	);

	const triggerButtonClass = $derived(
		cn(
			resolvedTriggerSize === "headerAction"
				? buttonVariants({ variant: "headerAction", size: "headerAction" })
				: buttonVariants({
						variant: triggerButtonProps.variant,
						size: triggerButtonProps.size,
						active: triggerActive,
					}),
			triggerClass,
			embeddedInGroup ? "!rounded-none" : "",
			className
		)
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

{#snippet selectorTriggerButton(buttonProps: Record<string, unknown>)}
	{#if embeddedInGroup}
		<button
			{...buttonProps}
			bind:this={triggerRef}
			type="button"
			data-slot="button"
			data-header-control={triggerSize === "attach" || triggerSize === "chromeIcon" ? true : undefined}
			class={triggerButtonClass}
			disabled={disabled}
			aria-label={resolvedTriggerAriaLabel}
			title={tooltipTitle ?? tooltipLabel ?? undefined}
		>
			{#if triggerIcon === "dots"}
				<RoundedIcon name="more" class={OVERFLOW_DOTS_ICON_CLASS} />
			{:else if triggerIcon === "gear"}
				<RoundedIcon name="settings" class={OVERFLOW_DOTS_ICON_CLASS} />
			{:else}
				{@render renderButton()}
			{/if}
			{#if showChevron}
				<RoundedIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground transition-transform duration-200 {open ? 'rotate-180' : ''}" />
			{/if}
		</button>
	{:else}
		<div role="group" class={cn("flex w-fit items-stretch", className)}>
			<Button
				{...buttonProps}
				bind:ref={triggerRef}
				variant={triggerButtonProps.variant}
				size={triggerButtonProps.size}
				class={triggerClass}
				{disabled}
				active={triggerActive}
				aria-label={resolvedTriggerAriaLabel}
				data-header-control={triggerSize === "attach" || triggerSize === "chromeIcon" ? true : undefined}
			>
				{#if triggerIcon === "dots"}
					<RoundedIcon name="more" class={OVERFLOW_DOTS_ICON_CLASS} />
				{:else if triggerIcon === "gear"}
					<RoundedIcon name="settings" class={OVERFLOW_DOTS_ICON_CLASS} />
				{:else}
					{@render renderButton()}
				{/if}
				{#if showChevron}
					<RoundedIcon name="chevron-down" class="size-3 shrink-0 text-muted-foreground transition-transform duration-200 {open ? 'rotate-180' : ''}" />
				{/if}
			</Button>
		</div>
	{/if}
{/snippet}

{#snippet selectorTrigger()}
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render selectorTriggerButton(props)}
		{/snippet}
	</DropdownMenu.Trigger>
{/snippet}

<DropdownMenu.Root bind:open {onOpenChange} class={embeddedInGroup ? "contents" : undefined}>
	{#if (tooltipLabel || tooltipDescription) && !embeddedInGroup}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: tooltipProps })}
					<DropdownMenu.Trigger>
						{#snippet child({ props: dropdownProps })}
							{@const props = mergeProps(tooltipProps, dropdownProps)}
							{@render selectorTriggerButton(props)}
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
