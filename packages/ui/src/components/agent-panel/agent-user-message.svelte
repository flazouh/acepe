<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import { InputContainer } from "../input-container/index.js";
	import { RichTokenText } from "../rich-token-text/index.js";

	interface Props {
		text: string;
		onTokenClick?: (tokenType: InlineArtefactTokenType, value: string) => void;
	}

	let { text, onTokenClick }: Props = $props();
</script>

<!-- Mirrors desktop MessageInputContainer / InputContainer visual -->
<InputContainer class="border border-border">
	<RichTokenText {text} {onTokenClick} class="text-foreground" />
</InputContainer>
