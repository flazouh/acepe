<script lang="ts">
import type { SessionStatus } from "$lib/acp/application/dto/session.js";

import { Badge } from "$lib/components/ui/badge/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	status: SessionStatus;
	isConnected: boolean;
	isStreaming: boolean;
}

let { status, isConnected, isStreaming }: Props = $props();

const config = $derived.by(() => {
	if (isStreaming) {
		return { variant: "default" as const, label: m.session_status_streaming() };
	}
	if (isConnected && status === "ready") {
		return { variant: "default" as const, label: m.session_status_ready() };
	}

	const configs: Record<
		SessionStatus,
		{ variant: "default" | "secondary" | "destructive" | "outline"; label: string }
	> = {
		idle: { variant: "secondary", label: m.session_status_idle() },
		loading: { variant: "outline", label: m.session_status_connecting() },
		connecting: { variant: "outline", label: m.session_status_connecting() },
		ready: { variant: "default", label: m.session_status_ready() },
		streaming: { variant: "default", label: m.session_status_streaming() },
		paused: { variant: "secondary", label: m.session_status_idle() },
		error: { variant: "destructive", label: m.session_status_error() },
	};

	return configs[status];
});
</script>

<Badge variant={config.variant} class="text-xs">{config.label}</Badge>
