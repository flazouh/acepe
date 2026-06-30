<script lang="ts">
import { RoundedIcon } from "@acepe/ui";

import type { PermissionRequest } from "../../types/permission.js";
import PermissionActionBar from "./permission-action-bar.svelte";
import { extractPermissionCommand } from "./permission-display.js";

interface Props {
	permission: PermissionRequest;
}

let { permission }: Props = $props();

// Extract command from Rust-parsed, agent-agnostic permission arguments.
const command = $derived(extractPermissionCommand(permission));

// Get the tool name for display
const toolName = $derived(permission.permission);
</script>

<div class="flex flex-col gap-1.5 min-w-0">
	<!-- Tool call card on top -->
	<div class="border rounded-md border-border bg-muted/30 min-w-0">
		<!-- Header -->
		<div class="flex items-center gap-2 px-3 py-2">
			<RoundedIcon name="terminal" class="size-4 text-muted-foreground shrink-0" />
			<span class="text-sm font-medium text-muted-foreground truncate">{toolName}</span>
		</div>

		<!-- Command display -->
		{#if command}
			<div class="px-3 pb-3">
				<div class="flex items-start gap-2 font-mono text-sm">
					<span class="text-muted-foreground/50 shrink-0">$</span>
					<code class="text-foreground break-all whitespace-pre-wrap">{command}</code>
				</div>
			</div>
		{/if}
	</div>

	<!-- Permission card below on the left -->
	<div class="flex justify-start">
		<PermissionActionBar {permission} />
	</div>
</div>
