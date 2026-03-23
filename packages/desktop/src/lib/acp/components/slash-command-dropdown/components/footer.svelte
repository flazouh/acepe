<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
</script>

<div class="px-3 py-1 border-t bg-muted/30 flex items-center gap-2 shrink-0">
	<kbd class="px-1 py-0.5 text-[10px] font-medium bg-muted rounded border">Enter</kbd>
	<span class="text-[10px] text-muted-foreground">{m.slash_command_select_hint()}</span>
	<kbd class="px-1 py-0.5 text-[10px] font-medium bg-muted rounded border ml-1.5">Esc</kbd>
	<span class="text-[10px] text-muted-foreground">{m.slash_command_close_hint()}</span>
</div>
