<script lang="ts">
import * as Dialog from "@acepe/ui/dialog";
import { PROJECT_CARD_ACTION_BUTTON_CLASS } from "@acepe/ui/panel-header";
import { X } from "phosphor-svelte";
import type { Snippet } from "svelte";

interface Props {
	open: boolean;
	title: string;
	children: Snippet;
	topLeft?: Snippet;
	topRight?: Snippet;
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
	contentClass = "",
	contentOverflow = "auto",
	closeLabel = "Close dialog",
	onOpenChange,
}: Props = $props();

const bodyClass = $derived(
	contentOverflow === "hidden"
		? "flex min-h-0 flex-1 flex-col overflow-hidden p-1"
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
			<div class={bodyClass}>
				{@render children()}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
