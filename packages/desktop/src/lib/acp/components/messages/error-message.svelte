<script lang="ts">
import WarningCircle from "phosphor-svelte/lib/WarningCircle";

import type { ErrorMessage } from "../../types/error-message.js";

interface Props {
	message: ErrorMessage;
}

let { message }: Props = $props();
</script>

<div class="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
	<WarningCircle weight="fill" class="h-3.5 w-3.5 flex-shrink-0 text-destructive/70" />
	<span class="break-words">{message.content}</span>
</div>
