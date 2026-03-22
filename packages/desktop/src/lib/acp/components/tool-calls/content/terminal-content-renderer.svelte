<script lang="ts">
import IconTerminal2 from "@tabler/icons-svelte/icons/terminal-2";

import type { TerminalContent } from "../../../schemas/tool-call-content.schema.js";

interface Props {
	content: TerminalContent;
}

let { content }: Props = $props();
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<div class="flex items-center gap-2 px-3 py-2 bg-muted/30">
		<IconTerminal2 class="size-3.5 text-muted-foreground" />
		<span class="text-xs font-medium text-foreground font-mono">
			Terminal: {content.terminalId}
		</span>
	</div>
	<div class="px-3 py-2 text-xs text-muted-foreground">
		Terminal session reference. Output will be shown in the terminal panel.
	</div>
</div>
