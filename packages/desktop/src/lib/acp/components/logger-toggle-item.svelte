<script lang="ts">
import { Switch } from "$lib/components/ui/switch/index.js";

import type { Logger } from "../utils/logger.js";

interface LoggerToggleItemProps {
	logger: Logger;
	onToggle: (loggerId: string, enabled: boolean) => void;
}

let { logger, onToggle }: LoggerToggleItemProps = $props();

const config = $derived(logger.getConfig());
const enabled = $derived(config.enabled ?? true);

function handleToggle(checked: boolean) {
	onToggle(config.id, checked);
}
</script>

<div class="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-accent">
	<span class="text-sm text-foreground flex-1 min-w-0 truncate">{config.name}</span>
	<Switch checked={enabled} onCheckedChange={handleToggle} />
</div>
