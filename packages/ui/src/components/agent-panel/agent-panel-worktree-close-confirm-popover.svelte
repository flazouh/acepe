<!--
  Headless confirmation popover for closing a session with an active worktree.
  All copy is supplied by the host app.
-->
<script lang="ts">
	import { Trash } from "phosphor-svelte";

	import * as Popover from "../popover/index.js";

	let {
		open = $bindable(false),
		headerAnchor,
		title,
		description,
		cancelLabel,
		confirmLabel,
		confirmDisabled = false,
		onCancel,
		onConfirmRemoveAndClose,
	}: {
		open?: boolean;
		headerAnchor: HTMLElement | undefined;
		title: string;
		description: string;
		cancelLabel: string;
		confirmLabel: string;
		confirmDisabled?: boolean;
		onCancel: () => void;
		onConfirmRemoveAndClose: () => void;
	} = $props();
</script>

<Popover.Root bind:open>
	<Popover.Content
		align="end"
		customAnchor={headerAnchor}
		class="w-52 p-0 overflow-hidden"
		onInteractOutside={onCancel}
	>
		<div class="px-2 py-2">
			<p class="text-sm font-medium">
				{title}
			</p>
			<p class="text-sm text-muted-foreground leading-snug mt-0.5">
				{description}
			</p>
		</div>
		<div class="flex items-stretch border-t border-border/30">
			<button
				type="button"
				class="flex-1 flex items-center justify-center px-2 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer border-r border-border/30"
				onclick={onCancel}
			>
				{cancelLabel}
			</button>
			<button
				type="button"
				class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
				onclick={onConfirmRemoveAndClose}
				disabled={confirmDisabled}
			>
				<Trash class="size-3" weight="fill" />
				{confirmLabel}
			</button>
		</div>
	</Popover.Content>
</Popover.Root>
