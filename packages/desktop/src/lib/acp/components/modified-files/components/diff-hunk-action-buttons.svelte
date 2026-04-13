<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import { CheckCircle } from "phosphor-svelte";
import { XCircle } from "phosphor-svelte";
import * as m from "$lib/messages.js";

interface Props {
	onUndo: () => void;
	onKeep: () => void;
}

let { onUndo, onKeep }: Props = $props();
</script>

<div class="flex items-center justify-end py-0.5 px-1">
	<div class="flex items-stretch rounded-md overflow-hidden shadow-md border border-border/60 backdrop-blur-sm bg-popover/90">
		<button
			type="button"
			class="h-6 px-1.5 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
			style="background: color-mix(in srgb, {Colors.red} 8%, transparent); color: {Colors.red};"
			title={m.review_undo_change()}
			onclick={onUndo}
		>
			<XCircle class="h-3 w-3 shrink-0" weight="fill" />
			{m.review_undo_change()}
		</button>
		<div class="w-px bg-border/50"></div>
		<button
			type="button"
			class="h-6 px-1.5 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
			style="background: color-mix(in srgb, {Colors.green} 8%, transparent); color: {Colors.green};"
			title={m.review_keep_change()}
			onclick={onKeep}
		>
			<CheckCircle class="h-3 w-3 shrink-0" weight="fill" />
			{m.review_keep_change()}
		</button>
	</div>
</div>
