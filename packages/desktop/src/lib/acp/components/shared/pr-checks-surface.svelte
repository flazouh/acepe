<script lang="ts">
import { onMount } from "svelte";

import { getSessionStore } from "$lib/acp/store/session-store.svelte.js";

interface Props {
	projectPath: string;
	prNumber: number;
	surfaceId: string;
}

let { projectPath, prNumber, surfaceId }: Props = $props();

const sessionStore = getSessionStore();

onMount(() => {
	return sessionStore.registerVisiblePrChecksSurface(projectPath, prNumber, surfaceId);
});
</script>
