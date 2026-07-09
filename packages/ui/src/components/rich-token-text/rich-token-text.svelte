<script lang="ts">
import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
import { tokenizeInlineArtefacts } from "../../lib/inline-artefact/index.js";
import { FilePathBadge } from "../file-path-badge/index.js";
import { InlineArtefactBadge } from "../inline-artefact-badge/index.js";
import {
	buildRichTokenTextClassName,
	buildRichTokenTextSegmentClassName,
} from "./rich-token-text.classes.js";

interface Props {
	text: string;
	onTokenClick?: (tokenType: InlineArtefactTokenType, value: string) => void;
	class?: string;
	singleLine?: boolean;
}

const {
	text,
	onTokenClick,
	class: className = "",
	singleLine = false,
}: Props = $props();

const segments = $derived(tokenizeInlineArtefacts(text));
const rootClassName = $derived(
	buildRichTokenTextClassName({ singleLine, className }),
);
const textSegmentClassName = $derived(
	buildRichTokenTextSegmentClassName({ singleLine }),
);

function isFileToken(tokenType: InlineArtefactTokenType): boolean {
	return tokenType === "file" || tokenType === "image";
}
</script>

<span class={rootClassName}>
	{#each segments as segment, i (i)}
		{#if segment.kind === "text"}
			<span class={textSegmentClassName}>{segment.text}</span>
		{:else if isFileToken(segment.tokenType)}
			<FilePathBadge
				filePath={segment.value}
				fileName={segment.label}
				size="sm"
				interactive={onTokenClick !== undefined}
				onSelect={onTokenClick
					? (event) => {
							event.stopPropagation();
							onTokenClick(segment.tokenType, segment.value);
						}
					: undefined}
			/>
		{:else}
			<InlineArtefactBadge
				tokenType={segment.tokenType}
				label={segment.label}
				value={segment.value}
				charCount={segment.charCount}
				tooltip={segment.title}
				onclick={onTokenClick
					? (e) => {
							e.stopPropagation();
							onTokenClick(segment.tokenType, segment.value);
						}
					: undefined}
			/>
		{/if}
	{/each}
</span>
