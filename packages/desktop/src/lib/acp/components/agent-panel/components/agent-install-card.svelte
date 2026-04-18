<script lang="ts">
	import { VoiceDownloadProgress } from "@acepe/ui";
	import { AgentPanelInstallCard as SharedAgentPanelInstallCard } from "@acepe/ui/agent-panel";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
import AgentIcon from "../../agent-icon.svelte";

interface Props {
	agentId: string;
	agentName: string;
	stage: string;
	progress: number;
}

let { agentId, agentName, stage, progress }: Props = $props();

const progressPercent = $derived(progress < 0 ? 0 : progress > 1 ? 100 : progress * 100);
const installTitle = $derived(`Setting up ${agentName}...`);
</script>

<SharedAgentPanelInstallCard
	title={installTitle}
	summary={stage}
	details={stage}
	{progressPercent}
	ariaLabel={`${installTitle} ${stage}`}
>
	{#snippet leading()}
		<Spinner class="size-[13px]" />
		<AgentIcon {agentId} class="size-3 shrink-0" size={12} />
	{/snippet}

	{#snippet progressIndicator()}
		<VoiceDownloadProgress
			ariaLabel={`${installTitle} ${stage}`}
			compact={true}
			label=""
			percent={progressPercent}
			segmentCount={20}
			showPercent={false}
		/>
	{/snippet}
</SharedAgentPanelInstallCard>
