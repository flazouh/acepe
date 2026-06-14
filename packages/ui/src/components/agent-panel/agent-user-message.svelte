<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";
	import { UserMessageContainer } from "../user-message-container/index.js";
	import AgentMessageMeta from "./agent-message-meta.svelte";

	interface Props {
		text: string;
		onTokenClick?: (tokenType: InlineArtefactTokenType, value: string) => void;
		timestampMs?: number;
	}

	let { text, onTokenClick, timestampMs }: Props = $props();
</script>

<!-- Mirrors desktop MessageInputContainer / InputContainer visual -->

<div class="group/user-message flex flex-col items-end gap-0.5">
	<UserMessageContainer class="border border-border">
		<RichTokenText {text} {onTokenClick} class="text-foreground" />
	</UserMessageContainer>
	<div
		class="pointer-events-none opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100"
	>
		<div class="pointer-events-auto">
			<AgentMessageMeta text={text} {timestampMs} variant="user" />
		</div>
	</div>
</div>
