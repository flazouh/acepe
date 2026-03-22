<script lang="ts">
import { Badge } from "$lib/components/ui/badge/index.js";
import { Card } from "$lib/components/ui/card/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { StoredPlan, StoredPlanStep } from "../infrastructure/storage/ThreadStorage.js";

let { plan }: { plan: StoredPlan } = $props();

const statusColor = (status: StoredPlanStep["status"]) => {
	switch (status) {
		case "pending":
			return "secondary";
		case "in_progress":
			return "default";
		case "completed":
			return "default";
		case "failed":
			return "destructive";
		default:
			return "secondary";
	}
};
</script>

<div class="flex justify-start mb-4">
	<Card class="max-w-[80%]">
		<div class="p-4 space-y-3">
			<h3 class="font-semibold">{m.plan_heading()}</h3>
			<div class="space-y-2">
				{#each plan.steps as step, index (index)}
					<div class="flex items-start gap-2">
						<Badge variant={statusColor(step.status)} class="shrink-0">
							{index + 1}
						</Badge>
						<div class="flex-1">
							<p class="text-sm">{step.description}</p>
							<Badge variant={statusColor(step.status)} class="mt-1 text-xs">
								{step.status}
							</Badge>
						</div>
					</div>
				{/each}
			</div>
			{#if plan.currentStep !== undefined}
				<div class="text-sm text-muted-foreground">
					{m.plan_current_step()}
					{plan.currentStep + 1}
				</div>
			{/if}
		</div>
	</Card>
</div>
