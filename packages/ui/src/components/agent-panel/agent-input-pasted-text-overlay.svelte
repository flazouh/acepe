<!--
  AgentInputPastedTextOverlay - Floating overlay for inspecting/editing pasted text references.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/pasted-text-overlay.svelte.
  Already presentational in desktop — copy verbatim with minor label externalization.
-->
<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { Check, X } from "phosphor-svelte";

	interface Props {
		mode: "preview" | "edit";
		refId: string;
		anchorRect: DOMRect;
		textContent: string;
		closeLabel?: string;
		cancelLabel?: string;
		saveLabel?: string;
		onSave: (refId: string, newText: string) => void;
		onClose: () => void;
		onMouseEnter?: () => void;
	}

	const OVERLAY_MAX_WIDTH = 480;

	let {
		mode,
		refId,
		anchorRect,
		textContent,
		closeLabel = "Close",
		cancelLabel = "Cancel",
		saveLabel = "Save",
		onSave,
		onClose,
		onMouseEnter,
	}: Props = $props();

	let overlayEl: HTMLDivElement | null = $state(null);
	let editText = $state(untrack(() => textContent));
	let top = $state(0);
	let left = $state(0);

	const isDirty = $derived(editText !== textContent);
	const allLines = $derived(editText.split("\n"));
	const lineCount = $derived(allLines.length);
	const charCount = $derived(editText.length);

	function reposition() {
		if (!overlayEl) return;
		const height = overlayEl.offsetHeight;
		const spaceAbove = anchorRect.top - 8;
		const computedTop = spaceAbove >= height ? anchorRect.top - height - 8 : anchorRect.bottom + 8;
		const computedLeft = Math.min(anchorRect.left, window.innerWidth - OVERLAY_MAX_WIDTH - 8);
		top = Math.max(8, computedTop);
		left = Math.max(8, computedLeft);
	}

	onMount(() => {
		reposition();
	});

	$effect(() => {
		void anchorRect;
		reposition();
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") onClose();
	}

	function handleSave() {
		onSave(refId, editText);
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") onClose();
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			handleSave();
		}
	}

	function handleOverlayMouseLeave(event: MouseEvent) {
		if (mode === "edit" || isDirty) return;
		const relatedTarget = event.relatedTarget as Element | null;
		const backToPill = relatedTarget?.closest('[data-inline-token-type="text_ref"]');
		if (!backToPill) {
			onClose();
		}
	}

	function handleOverlayMouseEnter() {
		onMouseEnter?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={overlayEl}
	data-pasted-text-overlay
	class="fixed z-50 rounded-lg border border-border/40 bg-popover shadow-sm overflow-hidden"
	style:top="{top}px"
	style:left="{left}px"
	style:min-width="320px"
	style:max-width="{OVERLAY_MAX_WIDTH}px"
	style:width="max-content"
	onmouseleave={handleOverlayMouseLeave}
	onmouseenter={handleOverlayMouseEnter}
>
	<div class="flex items-center justify-between px-2 py-0.5 border-b border-border/30">
		<span class="text-sm text-muted-foreground tabular-nums">{lineCount}L · {charCount.toLocaleString()}ch</span>
		<button
			type="button"
			class="inline-flex items-center justify-center size-5 text-muted-foreground hover:text-foreground transition-colors rounded"
			onclick={onClose}
			aria-label={closeLabel}
		>
			<X size={10} weight="bold" />
		</button>
	</div>

	<div class="px-2 py-1">
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			autofocus={mode === "edit"}
			class="min-h-[140px] w-full resize-y bg-transparent font-mono text-sm text-foreground outline-none"
			bind:value={editText}
			onkeydown={handleEditKeydown}
		></textarea>
	</div>

	{#if isDirty}
		<div class="flex items-center justify-end gap-1 border-t border-border/30 px-2 py-1">
			<button
				type="button"
				class="flex items-center gap-0.5 px-1.5 py-px rounded border border-border/50 bg-background/40 text-[10px] font-medium text-foreground/80 hover:text-foreground hover:bg-accent/60 transition-colors"
				onclick={onClose}
			>
				<X size={9} weight="bold" class="shrink-0" />
				{cancelLabel}
			</button>
			<button
				type="button"
				class="flex items-center gap-0.5 px-1.5 py-px rounded border border-border/50 bg-background/40 text-[10px] font-medium text-foreground/80 hover:text-foreground hover:bg-accent/60 transition-colors"
				onclick={handleSave}
			>
				<Check size={9} weight="bold" class="shrink-0" />
				{saveLabel}
			</button>
		</div>
	{/if}
</div>
