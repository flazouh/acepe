<script lang="ts">
import { ImageSquare } from "phosphor-svelte";

let { isDragHovering, label }: { isDragHovering: boolean; label: string } = $props();
</script>

<div
		class="flex-shrink-0 p-3 rounded-xl border border-dashed transition-all duration-150 {isDragHovering
			? 'border-foreground/40 bg-input/50'
			: 'border-border bg-input/30'}"
	>
		<div class="flex flex-col items-center justify-center gap-2 min-h-[80px]">
			<div
				class="p-2.5 rounded-lg transition-colors duration-150 {isDragHovering
					? 'bg-foreground/10'
					: 'bg-muted'}"
			>
				<ImageSquare
					class="h-5 w-5 transition-colors duration-150 {isDragHovering
						? 'text-foreground'
						: 'text-muted-foreground'}"
					weight="duotone"
				/>
			</div>
			<span
				class="text-sm transition-colors duration-150 {isDragHovering
					? 'text-foreground'
					: 'text-muted-foreground'}">{label}</span
			>
		</div>
	</div>
