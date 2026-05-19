<script lang="ts">
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { capitalizeName } from "$lib/acp/utils/index.js";

interface Props {
	agentId: string;
}

let { agentId }: Props = $props();

const displayName = $derived(capitalizeName(agentId));
</script>

<span title={displayName}>
	<AgentIcon {agentId} providerLabel={displayName} class="h-4 w-4" size={16} />
</span>
