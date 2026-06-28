<script lang="ts">
	import AgentPanelTranscriptScrollControls from "./agent-panel-transcript-scroll-controls.svelte";

	interface Props {
		visible: boolean;
		ariaLabel: string;
		onClick: () => void;
	}

	let { visible, ariaLabel, onClick }: Props = $props();
</script>

<AgentPanelTranscriptScrollControls
	showScrollToBottom={visible}
	scrollToBottomAriaLabel={ariaLabel}
	onScrollToBottom={onClick}
/>
