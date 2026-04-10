<script lang="ts">
interface TextBlock {
	text: string;
}

interface Props {
	block: TextBlock;
	isStreaming?: boolean;
	projectPath?: string;
}

let { block }: Props = $props();
let lineCount = $state(1);
</script>

{#if block.text === "thinking"}
	<button type="button" data-testid="grow-line" onclick={() => {
		lineCount += 1;
	}}>
		grow
	</button>
	<div data-testid="growing-content">
		{#each Array.from({ length: lineCount }) as _, index (index)}
			<div class="stub-line">line {index + 1}</div>
		{/each}
	</div>
{:else}
	<div>{block.text}</div>
{/if}
