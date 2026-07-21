<script lang="ts">
import { AgentInputMicButton, AgentInputVoiceModelMenu } from "@acepe/ui/agent-panel";
import { FusedPrimaryOverflowGroup } from "@acepe/ui/panel-header";

import type { MicButtonSpecimen } from "./design-system-mic-button-specimens.js";

interface Props {
	specimen?: MicButtonSpecimen;
	showFusedShell?: boolean;
}

let {
	specimen = {
		id: "demo",
		label: "Idle (fused)",
		caption: "Embedded in voice control group",
		visualState: "mic",
		embeddedInGroup: true,
	},
	showFusedShell = true,
}: Props = $props();

const mockVoiceModels = [
	{
		id: "whisper-base",
		name: "Whisper Base",
		sizeBytes: 142_000_000,
		isDownloaded: true,
		isDownloadable: true,
	},
	{
		id: "whisper-small",
		name: "Whisper Small",
		sizeBytes: 466_000_000,
		isDownloaded: false,
		isDownloadable: true,
	},
] as const;
</script>

{#if showFusedShell && specimen.embeddedInGroup}
	<FusedPrimaryOverflowGroup>
		{#snippet primary()}
			<AgentInputMicButton
				embeddedInGroup
				visualState={specimen.visualState}
				downloadPercent={specimen.downloadPercent ?? 0}
				disabled={specimen.disabled ?? false}
				title={specimen.label}
				ariaLabel={specimen.label}
			/>
		{/snippet}
		{#snippet overflow()}
			<AgentInputVoiceModelMenu
				embeddedInGroup
				models={mockVoiceModels}
				selectedModelId="whisper-base"
				onSelectModel={() => {}}
				onDownloadModel={() => {}}
				onUninstallModel={() => {}}
			/>
		{/snippet}
	</FusedPrimaryOverflowGroup>
{:else}
	<AgentInputMicButton
		embeddedInGroup={specimen.embeddedInGroup}
		visualState={specimen.visualState}
		downloadPercent={specimen.downloadPercent ?? 0}
		disabled={specimen.disabled ?? false}
		title={specimen.label}
		ariaLabel={specimen.label}
	/>
{/if}
