<script lang="ts">
import { RoundedIcon } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import { XCircle } from "phosphor-svelte";
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
			class="h-6 px-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40"
			title={"Undo"}
			onclick={onUndo}
		>
			<XCircle class="h-3 w-3 shrink-0" style="color: {Colors.red};" weight="fill" />
			{"Undo"}
		</button>
		<div class="w-px bg-border/50"></div>
		<button
			type="button"
			class="h-6 px-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40"
			title={"Keep"}
			onclick={onKeep}
		>
			<RoundedIcon name="check-circle" class="h-3 w-3 shrink-0" style="color: {Colors.green};" />
			{"Keep"}
		</button>
	</div>
</div>
