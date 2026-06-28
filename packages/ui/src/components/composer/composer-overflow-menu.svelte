<script lang="ts">
	import type { Snippet } from "svelte";
	import { Gear } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
		FusedOverflowDotsTrigger,
		OVERFLOW_DOTS_ICON_CLASS,
	} from "../panel-header/index.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		ariaLabel: string;
		title?: string;
		align?: "start" | "center" | "end";
		side?: "top" | "right" | "bottom" | "left";
		sideOffset?: number;
		contentClass?: string;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** When true, dropdown root uses display:contents for fused button groups. */
		embeddedInGroup?: boolean;
		/** dots = three-dot overflow; gear = setup settings trigger. */
		triggerIcon?: "dots" | "gear";
		triggerClass?: string;
		children: Snippet;
	}

	let {
		ariaLabel,
		title,
		align = "end",
		side = "top",
		sideOffset = 8,
		contentClass = "min-w-[11rem] p-1",
		open = $bindable(false),
		onOpenChange,
		embeddedInGroup = false,
		triggerIcon = "dots",
		triggerClass = "",
		children,
	}: Props = $props();
</script>

<DropdownMenu.Root bind:open {onOpenChange} class={embeddedInGroup ? "contents" : undefined}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{#if triggerIcon === "gear"}
				<button
					{...props}
					type="button"
					data-slot="button"
					data-header-control
					aria-label={ariaLabel}
					title={title ?? ariaLabel}
					class={cn(FUSED_CONTROL_OVERFLOW_BUTTON_CLASS, triggerClass)}
				>
					<Gear class={OVERFLOW_DOTS_ICON_CLASS} weight="fill" />
				</button>
			{:else}
				<FusedOverflowDotsTrigger
					{...props}
					{ariaLabel}
					title={title ?? ariaLabel}
					class={triggerClass}
				/>
			{/if}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {align} {side} {sideOffset} class={contentClass}>
		{@render children()}
	</DropdownMenu.Content>
</DropdownMenu.Root>
