<script lang="ts">
	import Self from "./native-markdown-block.svelte";
	import NativeMarkdownCodeBlock from "./native-markdown-code-block.svelte";
	import NativeMarkdownInline from "./native-markdown-inline.svelte";
	import type {
		NativeMarkdownBlock,
		NativeMarkdownInline as NativeMarkdownInlineToken,
		NativeMarkdownTableAlign,
	} from "./native-markdown-model.js";
	import type { TogglePrLinkPayload } from "./types.js";

	interface Props {
		block: NativeMarkdownBlock;
		wordCount: number;
		onExternalLinkClick?: (url: string) => void;
		onFilePathClick?: (filePath: string) => void;
		linkedPrNumber?: number | null;
		onTogglePrLink?: (payload: TogglePrLinkPayload) => void;
	}

	let {
		block,
		wordCount,
		onExternalLinkClick,
		onFilePathClick,
		linkedPrNumber,
		onTogglePrLink,
	}: Props = $props();

	function headingTag(depth: number): string {
		if (depth <= 1) return "h1";
		if (depth === 2) return "h2";
		if (depth === 3) return "h3";
		if (depth === 4) return "h4";
		if (depth === 5) return "h5";
		return "h6";
	}

	function cellAlignClass(align: NativeMarkdownTableAlign): string {
		if (align === "center") return "text-center";
		if (align === "right") return "text-right";
		return "text-left";
	}
</script>

{#snippet renderInlines(children: readonly NativeMarkdownInlineToken[])}
	{#each children as child (child.key)}
		<NativeMarkdownInline
			token={child}
			{wordCount}
			{onExternalLinkClick}
			{onFilePathClick}
			{linkedPrNumber}
			{onTogglePrLink}
		/>
	{/each}
{/snippet}

{#if block.type === "text"}
	{@render renderInlines(block.children)}
{:else if block.type === "paragraph"}
	<p>{@render renderInlines(block.children)}</p>
{:else if block.type === "heading"}
	<svelte:element this={headingTag(block.depth)}>
		{@render renderInlines(block.children)}
	</svelte:element>
{:else if block.type === "code"}
	<NativeMarkdownCodeBlock
		code={block.code}
		language={block.language}
		meta={block.meta}
		isIncomplete={block.isIncomplete}
	/>
{:else if block.type === "list"}
	{#if block.ordered}
		<ol start={block.start ?? undefined} data-native-markdown="ordered-list">
			{#each block.items as item (item.key)}
				<li data-native-markdown="list-item">
					{#each item.blocks as itemBlock (itemBlock.key)}
						<Self
							block={itemBlock}
							{wordCount}
							{onExternalLinkClick}
							{onFilePathClick}
							{linkedPrNumber}
							{onTogglePrLink}
						/>
					{/each}
				</li>
			{/each}
		</ol>
	{:else}
		<ul data-native-markdown="unordered-list">
			{#each block.items as item (item.key)}
				<li data-native-markdown="list-item">
					{#each item.blocks as itemBlock (itemBlock.key)}
						<Self
							block={itemBlock}
							{wordCount}
							{onExternalLinkClick}
							{onFilePathClick}
							{linkedPrNumber}
							{onTogglePrLink}
						/>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
{:else if block.type === "blockquote"}
	<blockquote>
		{#each block.blocks as childBlock (childBlock.key)}
			<Self
				block={childBlock}
				{wordCount}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</blockquote>
{:else if block.type === "table"}
	<div class="acepe-table-wrapper">
		<table>
			<thead>
				<tr>
					{#each block.header as cell (cell.key)}
						<th class={cellAlignClass(cell.align)}>{@render renderInlines(cell.children)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each block.rows as row}
					<tr>
						{#each row as cell (cell.key)}
							<td class={cellAlignClass(cell.align)}>{@render renderInlines(cell.children)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if block.type === "hr"}
	<hr />
{/if}
