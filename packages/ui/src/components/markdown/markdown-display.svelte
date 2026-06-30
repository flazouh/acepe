<script lang="ts">
	import NativeMarkdown from "../native-markdown/native-markdown.svelte";

	interface Props {
		content: string;
		class?: string;
		scrollable?: boolean;
		/** Text size class for the markdown content (e.g. "text-sm", "text-xs"). Defaults to "text-sm". */
		textSize?: string;
		/** Padding class applied to the rendered markdown wrapper. Defaults to "p-6". */
		contentPaddingClass?: string;
		/** Preserved for API compatibility. */
		errorMessage?: (error: string) => string;
		/** Preserved for API compatibility. */
		iconBasePath?: string;
	}

	let {
		content,
		class: className = "",
		scrollable = false,
		textSize = "text-sm",
		contentPaddingClass = "p-6",
		errorMessage: _errorMessage,
		iconBasePath: _iconBasePath,
	}: Props = $props();
</script>

<div
	class="min-w-0 max-w-full overflow-x-hidden overflow-y-auto {scrollable
		? 'markdown-display-scrollable h-full w-full'
		: ''} {className}"
>
	<NativeMarkdown
		markdown={content}
		class="min-w-0 max-w-full {contentPaddingClass} {textSize} leading-relaxed text-foreground"
	/>
</div>
