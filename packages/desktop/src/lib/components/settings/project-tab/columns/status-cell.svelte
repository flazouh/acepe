<script lang="ts">
import type { SessionStatus } from "$lib/acp/application/dto/session.js";

import { Badge } from "$lib/components/ui/badge/index.js";
interface Props {
	status: SessionStatus;
	isConnected: boolean;
	isStreaming: boolean;
}

let { status, isConnected, isStreaming }: Props = $props();

const config = $derived.by(() => {
	if (isStreaming) {
		return { variant: "default" as const, label: "Streaming" };
	}
	if (isConnected && status === "ready") {
		return { variant: "default" as const, label: "Ready" };
	}

	const configs: Record<
		SessionStatus,
		{ variant: "default" | "secondary" | "destructive" | "outline"; label: string }
	> = {
		idle: { variant: "secondary", label: "Idle" },
		loading: { variant: "outline", label: "Connecting" },
		connecting: { variant: "outline", label: "Connecting" },
		ready: { variant: "default", label: "Ready" },
		streaming: { variant: "default", label: "Streaming" },
		paused: { variant: "secondary", label: "Idle" },
		error: { variant: "destructive", label: "Error" },
	};

	return configs[status];
});
</script>

<Badge variant={config.variant} class="text-xs">{config.label}</Badge>
