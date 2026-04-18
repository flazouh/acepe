<script lang="ts">
import * as Empty from "$lib/components/ui/empty/index.js";
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
			<img src={agentIconSrc} alt={"Agent"} class="size-10" />
		</Empty.Media>
		<Empty.Title>{"Ready to assist"}</Empty.Title>
		<Empty.Description>{"Start typing to begin"}</Empty.Description>
	</Empty.Header>
</Empty.Root>
