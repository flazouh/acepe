<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import XCircle from "phosphor-svelte/lib/XCircle";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	onUndo: () => void;
	onKeep: () => void;
}

let { onUndo, onKeep }: Props = $props();

/** Embedded design: matches EmbeddedIconButton (h-7, no border, no rounding, hover:accent/50) */
const embeddedButtonClass =
	"h-7 inline-flex items-center justify-center gap-1 px-2 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none";
</script>

<div class="flex items-stretch h-7 border-y border-border/50" data-header-control>
	<div class="flex-1"></div>
	<button type="button" class="{embeddedButtonClass} border-l border-border/50" title={m.review_undo_change()} onclick={onUndo}>
		<XCircle class="h-3 w-3 shrink-0" weight="fill" style="color: {Colors.red}" />
		{m.review_undo_change()}
	</button>
	<button type="button" class="{embeddedButtonClass} border-l border-border/50" title={m.review_keep_change()} onclick={onKeep}>
		<CheckCircle class="h-3 w-3 shrink-0 text-success" weight="fill" />
		{m.review_keep_change()}
	</button>
</div>
