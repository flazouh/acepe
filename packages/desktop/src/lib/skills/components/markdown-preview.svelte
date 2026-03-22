<script lang="ts">
import { MarkdownDisplay } from "@acepe/ui/markdown-display";

let { content }: { content: string } = $props();
</script>

<MarkdownDisplay {content} scrollable class="h-full w-full" />
