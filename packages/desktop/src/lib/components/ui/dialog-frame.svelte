<script lang="ts">
import * as Dialog from "@acepe/ui/dialog";
import { PROJECT_CARD_ACTION_BUTTON_CLASS } from "@acepe/ui/panel-header";
import { X } from "@acepe/ui/icons";
import type { Snippet } from "svelte";

interface Props {
	open?: boolean;
	title: string;
	children: Snippet;
	topLeft?: Snippet;
	topRight?: Snippet;
	footer?: Snippet;
	contentClass?: string;
	contentOverflow?: "auto" | "hidden";
	closeLabel?: string;
	/** default = large panel; compact = settings; form/medium/wide = sized forms; panel/debug = tool surfaces; palette* = command palettes; bare = chromeless overlay. */
	size?:
		| "default"
		| "compact"
		| "form"
		| "medium"
		| "wide"
		| "panel"
		| "debug"
		| "palette"
		| "palette-lg"
		| "bare";
	portalDisabled?: boolean;
	hideHeader?: boolean;
	contentRef?: HTMLElement | null;
	onOpenAutoFocus?: (event: Event) => void;
	onOpenChange?: (open: boolean) => void;
}

let {
	open = $bindable(false),
	title,
	children,
	topLeft,
	topRight,
	footer,
	contentClass = "",
	contentOverflow = "auto",
	closeLabel = "Close dialog",
	size = "default",
	portalDisabled = false,
	hideHeader = false,
	contentRef = $bindable(null),
	onOpenAutoFocus,
	onOpenChange,
}: Props = $props();

const dialogSizeClass = $derived(
	size === "form"
		? "h-auto w-full sm:max-w-md max-h-[min(86vh,860px)]"
		: size === "medium"
			? "h-auto w-full max-w-lg max-h-[70vh]"
			: size === "wide"
				? "h-auto w-full sm:max-w-2xl max-h-[min(86vh,860px)]"
				: size === "panel"
					? "h-[70vh] max-h-[700px] w-full max-w-5xl"
					: size === "debug"
						? "h-[85vh] max-h-[900px] w-full max-w-6xl"
						: size === "palette"
							? "h-auto w-full max-w-md"
							: size === "palette-lg"
								? "h-auto w-full max-w-lg"
								: size === "bare"
									? "h-[90vh] w-fit max-w-[96vw]"
									: size === "compact"
										? "h-[min(78vh,680px)] w-[min(92vw,920px)]"
										: "h-[min(86vh,860px)] w-[min(94vw,1180px)]"
);

const isAutoHeight = $derived(
	size === "form" ||
		size === "medium" ||
		size === "wide" ||
		size === "palette" ||
		size === "palette-lg" ||
		size === "bare"
);

const shellClass = $derived(isAutoHeight ? "flex flex-col" : "flex h-full min-h-0 flex-col");

const bodyClass = $derived(
	size === "palette" || size === "palette-lg"
		? "overflow-hidden p-0"
		: isAutoHeight
			? "overflow-visible p-0"
			: contentOverflow === "hidden"
				? "flex min-h-0 flex-1 flex-col overflow-hidden p-0.5"
				: "min-h-0 flex-1 overflow-y-auto p-0.5"
);

function handleOpenChange(nextOpen: boolean): void {
	open = nextOpen;
	onOpenChange?.(nextOpen);
}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		bind:ref={contentRef}
		class="!flex {dialogSizeClass} min-h-0 max-w-none flex-col overflow-hidden p-0 {contentClass}"
		showCloseButton={false}
		portalProps={portalDisabled ? { disabled: true } : undefined}
		onOpenAutoFocus={onOpenAutoFocus}
	>
		<Dialog.Title class="sr-only">{title}</Dialog.Title>
		<div class={shellClass}>
			{#if !hideHeader}
				<div class="flex min-h-6 shrink-0 items-center gap-2 px-1 pt-1">
					<div class="flex min-w-0 flex-1 items-center gap-1.5">
						{#if topLeft}
							{@render topLeft()}
						{/if}
					</div>
					{#if topRight}
						<div class="flex shrink-0 items-center gap-1.5">
							{@render topRight()}
						</div>
					{/if}
					<Dialog.Close
						aria-label={closeLabel}
						class="{PROJECT_CARD_ACTION_BUTTON_CLASS} shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
						data-header-control
					>
						<X size={12} weight="bold" />
					</Dialog.Close>
				</div>
			{/if}
			<div class={bodyClass}>
				{@render children()}
			</div>
			{#if footer}
				<div
					class="flex shrink-0 items-center justify-end gap-1 border-t border-border/30 px-1"
					style="height: 28px;"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
