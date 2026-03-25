<script lang="ts">
import { okAsync } from "neverthrow";
import type { Attachment } from "$lib/acp/components/agent-input/types/attachment.js";
import { createMessageQueueStore } from "$lib/acp/store/message-queue/message-queue-store.svelte.js";

import QueueCardStrip from "../queue-card-strip.svelte";

interface MessageSeed {
	content: string;
	attachments: readonly Attachment[];
}

interface Props {
	sessionId: string;
	messages: readonly MessageSeed[];
}

let { sessionId, messages }: Props = $props();

const sender = {
	sendMessage() {
		return okAsync(undefined);
	},
};

const store = createMessageQueueStore(sender);

for (const message of messages) {
	store.enqueue(sessionId, message.content, message.attachments);
}
</script>

<QueueCardStrip {sessionId} />
