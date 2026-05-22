<script lang="ts">
import { buildAudioBlockDisplayState } from "./media-block-state.js";

interface Props {
	data: string;
	mimeType: string;
}

let { data, mimeType }: Props = $props();

const audioState = $derived(buildAudioBlockDisplayState({ data, mimeType }));
</script>

<div class="space-y-1">
	<div class="text-xs text-muted-foreground">{audioState.label}</div>
	<audio controls class="w-full">
		<source src={audioState.src} />
	</audio>
</div>
