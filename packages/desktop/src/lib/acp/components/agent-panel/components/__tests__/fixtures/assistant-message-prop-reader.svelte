<script lang="ts">
import { onMount } from "svelte";

type AssistantMessageStubProps = {
	message: { chunks: readonly object[] } | undefined;
};

let { message }: AssistantMessageStubProps = $props();
const chunkCount = $derived(message?.chunks.length ?? 0);

onMount(() => {
	return () => {
		void message?.chunks.length;
	};
});
</script>

<div data-testid="assistant-message-stub">{chunkCount}</div>
