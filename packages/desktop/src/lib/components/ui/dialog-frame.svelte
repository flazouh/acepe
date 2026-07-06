<script lang="ts">
import * as Dialog from "@acepe/ui/dialog";
import {
	getDialogHeaderIconCloseClass,
	RoundedIcon,
	type HeaderIconCloseSize,
} from "@acepe/ui";
import type { Snippet } from "svelte";

type DialogFrameCloseControl = Snippet<[]>;

interface DialogFrameContentContext {
	closeControl: DialogFrameCloseControl;
}

interface Props {
	open?: boolean;
	title: string;
	children?: Snippet;
	frameContent?: Snippet<[DialogFrameContentContext]>;
	titleLeading?: Snippet;
	topLeft?: Snippet;
	topRight?: Snippet;
	footer?: Snippet;
	contentClass?: string;
	contentOverflow?: "auto" | "hidden";
	closeLabel?: string;
	headerIconSize?: HeaderIconCloseSize;
	showTitle?: boolean;
	/** default = large panel; compact = settings; fullscreen = edge-to-edge window; form/medium/wide = sized forms; panel/debug = tool surfaces; palette* = command palettes; bare = chromeless overlay. */
	size?:
		| "default"
		| "compact"
		| "fullscreen"
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
	frameContent,
	titleLeading,
	topLeft,
	topRight,
	footer,
	contentClass = "",
	contentOverflow = "auto",
	closeLabel = "Close dialog",
	headerIconSize = "icon",
	showTitle = true,
	size = "default",
	portalDisabled = false,
	hideHeader = false,
	contentRef = $bindable(null),
	onOpenAutoFocus,
	onOpenChange,
}: Props = $props();

const dialogSizeClass = $derived(
	size === "fullscreen"
		? "h-[100dvh] w-screen max-h-none max-w-none rounded-none border-0 shadow-none"
		: size === "form"
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

const rendersVisibleTitle = $derived(!hideHeader && showTitle);

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

{#snippet closeControl()}
	<Dialog.Close
		aria-label={closeLabel}
		class={getDialogHeaderIconCloseClass(headerIconSize)}
		data-header-control
	>
		<RoundedIcon name="close" />
	</Dialog.Close>
{/snippet}

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		bind:ref={contentRef}
		class="!flex {dialogSizeClass} min-h-0 max-w-none flex-col overflow-hidden p-0 {contentClass}"
		showCloseButton={false}
		portalProps={portalDisabled ? { disabled: true } : undefined}
		onOpenAutoFocus={onOpenAutoFocus}
	>
		{#if !rendersVisibleTitle}
			<Dialog.Title class="sr-only">{title}</Dialog.Title>
		{/if}
		<div class={shellClass}>
			{#if !hideHeader}
				<div
					class="flex min-h-8 shrink-0 items-center gap-2 px-2 py-1"
					data-dialog-frame-header
				>
					<div class="flex min-w-0 flex-1 items-center gap-1.5">
						{#if titleLeading}
							{@render titleLeading()}
						{/if}
						{#if showTitle}
							<Dialog.Title
								class="min-w-0 truncate text-[11px] font-semibold leading-none text-foreground select-none"
								data-dialog-frame-title
							>
								{title}
							</Dialog.Title>
						{/if}
						{#if topLeft}
							{@render topLeft()}
						{/if}
					</div>
					{#if topRight}
						<div class="flex shrink-0 items-center gap-1.5">
							{@render topRight()}
						</div>
					{/if}
					{@render closeControl()}
				</div>
			{/if}
			{#if frameContent}
				{@render frameContent({ closeControl })}
			{:else if children}
				<div class={bodyClass}>
					{@render children()}
				</div>
			{/if}
			{#if footer}
				<div
					class="flex shrink-0 items-center justify-end gap-1.5 border-t border-border/30 px-2 py-1.5"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
