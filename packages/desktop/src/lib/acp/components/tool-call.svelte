<script lang="ts">
import { Badge } from "$lib/components/ui/badge/index.js";
import { Card } from "$lib/components/ui/card/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { ToolCall } from "../types/tool-call.js";

let { toolCall }: { toolCall: ToolCall } = $props();

const statusColor = $derived.by(() => {
	switch (toolCall.status) {
		case "pending":
			return "secondary";
		case "in_progress":
			return "default";
		case "completed":
			return "default";
		case "failed":
			return "destructive";
		default:
			return "secondary";
	}
});
</script>

<div class="flex justify-start mb-4">
	<Card class="max-w-[80%]">
		<div class="p-4 space-y-2">
			<div class="flex items-center gap-2">
				<Badge variant={statusColor}>{toolCall.status}</Badge>
				<span class="font-medium">{toolCall.name}</span>
			</div>
			{#if toolCall.arguments && Object.keys(toolCall.arguments).length > 0}
				<div class="text-sm text-muted-foreground">
					<pre class="whitespace-pre-wrap">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
				</div>
			{/if}
			{#if toolCall.result !== undefined}
				<div class="text-sm">
					<strong>{m.tool_call_result_label()}</strong>
					<pre class="whitespace-pre-wrap mt-1">{JSON.stringify(toolCall.result, null, 2)}</pre>
				</div>
			{/if}
		</div>
	</Card>
</div>
