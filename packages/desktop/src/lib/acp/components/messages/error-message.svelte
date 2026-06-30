<script lang="ts">
import { RoundedIcon } from "@acepe/ui";

import type { ErrorMessage } from "../../types/error-message.js";

interface Props {
	message: ErrorMessage;
}

let { message }: Props = $props();
</script>

<div class="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
	<RoundedIcon name="warning" class="h-3.5 w-3.5 flex-shrink-0 text-destructive/70" />
	<span class="break-words">{message.content}</span>
</div>
