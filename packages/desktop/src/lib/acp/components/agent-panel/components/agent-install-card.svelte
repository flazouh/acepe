<script lang="ts">
import {
	AgentInstallingLabel,
	AgentPanelInstallCard as SharedAgentPanelInstallCard,
} from "@acepe/ui/agent-panel";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import AgentIcon from "../../agent-icon.svelte";

// No stage and no percentage. Installing an agent runs over the agentCall
// utility RPC, which is request/response: the backend answers once, when the
// download, checksum check and extract are all done. Nothing arrives in
// between, so this card reports that it is working and nothing more. It used
// to take a `progress` number that only ever held 0.
interface Props {
	agentId: string;
	agentName: string;
}

let { agentId, agentName }: Props = $props();

const installTitle = $derived(`Setting up ${agentName}...`);
const installSummary = "Downloading and verifying the agent";
</script>

<SharedAgentPanelInstallCard title={installTitle} summary={installSummary}>
	{#snippet leading()}
		<Spinner size={13} />
		<AgentIcon {agentId} class="size-3 shrink-0" size={12} />
	{/snippet}

	{#snippet progressIndicator()}
		<AgentInstallingLabel class="text-[0.6875rem] text-muted-foreground" />
	{/snippet}
</SharedAgentPanelInstallCard>
