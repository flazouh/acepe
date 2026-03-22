<script lang="ts">
import * as Empty from "$lib/components/ui/empty/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	agentIconSrc: string;
	isFullscreen?: boolean;
}

// isFullscreen is accepted but not used - placeholder is already centered
let { agentIconSrc }: Props = $props();
</script>

<Empty.Root class="border-0 h-full flex items-center justify-center">
	<Empty.Header>
		<Empty.Media variant="default">
			<img src={agentIconSrc} alt={m.alt_agent_icon()} class="size-10" />
		</Empty.Media>
		<Empty.Title>{m.agent_panel_ready_to_assist()}</Empty.Title>
		<Empty.Description>{m.agent_panel_start_typing()}</Empty.Description>
	</Empty.Header>
</Empty.Root>
