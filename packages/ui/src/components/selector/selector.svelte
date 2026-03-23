<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils.js";
	import { Button, type ButtonVariant } from "../button/index.js";

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
		 * CSS class for the root container.
		 */
		class?: string;

		/**
		 * CSS class for the dropdown content.
		 */
		contentClass?: string;

		/**
		 * Button variant for the selector button.
		 */
		variant?: ButtonVariant;

		/**
		 * Callback when open state changes.
		 */
		onOpenChange?: (isOpen: boolean) => void;

		/**
		 * Optional extra class for the trigger button (e.g. empty-state styling).
		 */
		buttonClass?: string;
	}

	let {
		renderButton,
		children,
		open = $bindable(false),
		disabled = false,
		align = "end",
		class: className,
		contentClass,
		variant = "outline",
		onOpenChange,
		buttonClass,
	}: Props = $props();

	export function toggle() {
		open = !open;
		onOpenChange?.(open);
	}
</script>

<DropdownMenu.Root bind:open {onOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<div role="group" class={cn("flex w-fit items-stretch", className)}>
				<Button
					{...props}
					{variant}
					size="sm"
					class={cn(
						"gap-1.5 h-7 flex-1 min-w-0 max-w-full rounded-none border-0 px-2 text-[11px]",
						buttonClass
					)}
					{disabled}
				>
					{@render renderButton()}
					<ChevronDown
						class="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 {open
							? 'rotate-180'
							: ''}"
					/>
				</Button>
			</div>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content
		{align}
		sideOffset={4}
		class={cn("w-fit max-w-[280px]", contentClass)}
	>
		{@render children()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
