<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import * as Dialog from "@acepe/ui/dialog";
import XIcon from "@lucide/svelte/icons/x";
import type { Snippet } from "svelte";

interface Props {
	open: boolean;
	title: string;
	children: Snippet;
	contentClass?: string;
	closeLabel?: string;
	onOpenChange: (open: boolean) => void;
}

let {
	open,
	title,
	children,
	contentClass = "",
	closeLabel = "Close dialog",
	onOpenChange,
}: Props = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content
		class="h-[min(86vh,860px)] w-[min(94vw,1180px)] max-w-none overflow-visible p-1 {contentClass}"
		showCloseButton={false}
	>
		<Dialog.Title class="sr-only">{title}</Dialog.Title>
		<Dialog.Close
			aria-label={closeLabel}
			class="workspace-dialog-close absolute right-0 top-0 z-30 inline-flex size-5 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border border-border/70 bg-popover text-muted-foreground/70 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			style="--workspace-dialog-close-hover: {Colors.red};"
		>
			<XIcon class="size-3" />
		</Dialog.Close>
		{@render children()}
	</Dialog.Content>
</Dialog.Root>

<style>
	.workspace-dialog-close:hover {
		color: var(--workspace-dialog-close-hover);
		border-color: color-mix(in srgb, var(--workspace-dialog-close-hover) 55%, transparent);
		background-color: color-mix(in srgb, var(--workspace-dialog-close-hover) 10%, var(--accent));
	}
</style>
