<script lang="ts">
import type { SessionEntry } from "../../../application/dto/session.js";

import UserMessage from "../../messages/user-message.svelte";

interface StickyUserMessageProps {
	/** The user entry to display, or null to hide the sticky header */
	entry: SessionEntry | null;
	/** Whether the panel is in fullscreen mode */
	isFullscreen?: boolean;
}

let { entry, isFullscreen = false }: StickyUserMessageProps = $props();

// Only render if entry exists and is a user type
const shouldShow = $derived(entry !== null && entry.type === "user");
</script>

{#if shouldShow && entry?.type === "user"}
	<div class="sticky top-0 z-10 p-2 {isFullscreen ? 'flex justify-center' : ''}">
		<UserMessage message={entry.message} />
	</div>
{/if}
