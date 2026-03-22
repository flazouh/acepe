<script lang="ts">
interface Props {
	patch: string;
}

let { patch }: Props = $props();
</script>

<div class="border-t border-border/20 bg-muted/5 p-3">
	<div class="mb-2 text-[11px] text-muted-foreground">
		Large diff: showing a fast plain-text preview.
	</div>
	<pre
		data-testid="plain-text-diff-preview"
		class="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-background/70 p-3 text-[11px] leading-relaxed text-foreground"
	>{patch}</pre>
</div>
