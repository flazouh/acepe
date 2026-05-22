<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import * as Dialog from "@acepe/ui/dialog";
import XIcon from "@lucide/svelte/icons/x";
import type { Snippet } from "svelte";

interface Props {
	open: boolean;
	title: string;
	children: Snippet;
	topLeft?: Snippet;
	topRight?: Snippet;
	showTitle?: boolean;
	contentClass?: string;
	contentOverflow?: "auto" | "hidden";
	closeLabel?: string;
	onOpenChange: (open: boolean) => void;
}

let {
	open,
	title,
	children,
	topLeft,
	topRight,
	showTitle = true,
	contentClass = "",
	contentOverflow = "auto",
	closeLabel = "Close dialog",
	onOpenChange,
}: Props = $props();

const bodyClass = $derived(
	contentOverflow === "hidden"
		? "min-h-0 flex-1 overflow-hidden p-1"
		: "min-h-0 flex-1 overflow-y-auto p-1"
);
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content
		class="!flex h-[min(86vh,860px)] min-h-0 w-[min(94vw,1180px)] max-w-none flex-col overflow-hidden p-0 {contentClass}"
		showCloseButton={false}
	>
		<Dialog.Title class="sr-only">{title}</Dialog.Title>
		<div class="flex h-full min-h-0 flex-col">
			<div class="flex min-h-6 shrink-0 items-center gap-2 px-1 pt-1">
				<div class="flex min-w-0 flex-1 items-center gap-1.5">
					{#if showTitle}
						<span class="truncate text-[11px] font-medium text-foreground leading-none">
							{title}
						</span>
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
				<Dialog.Close
					aria-label={closeLabel}
					class="workspace-dialog-close inline-flex size-5 shrink-0 items-center justify-center rounded border border-border/70 bg-popover text-muted-foreground/70 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					style="--workspace-dialog-close-hover: {Colors.red};"
				>
					<XIcon class="size-3" />
				</Dialog.Close>
			</div>
			<div class={bodyClass}>
				{@render children()}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.workspace-dialog-close:hover {
		color: var(--workspace-dialog-close-hover);
		border-color: color-mix(in srgb, var(--workspace-dialog-close-hover) 55%, transparent);
		background-color: color-mix(in srgb, var(--workspace-dialog-close-hover) 10%, var(--accent));
	}
</style>
