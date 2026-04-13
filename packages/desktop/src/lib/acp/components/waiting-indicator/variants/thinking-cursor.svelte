<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import * as m from "$lib/messages.js";
</script>

<div class="py-3 text-muted-foreground text-sm">
	<TextShimmer>{m.waiting_planning_next_moves()}</TextShimmer>
</div>
