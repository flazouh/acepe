<script lang="ts">
import { IconAlertCircle, IconCircleCheckFilled } from "@tabler/icons-svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import type { SessionStatus } from "../state/index.js";
import { resolveSessionStatusIndicatorPresentation } from "./session-status-indicator-presentation.js";

import { Colors } from "@acepe/ui/colors";

interface SessionStatusIndicatorProps {
	/** Current status of the session */
	status: SessionStatus;
	/** Size of the indicator in pixels */
	size?: number;
	/** Whether to show the indicator (hides when connected after delay) */
	show?: boolean;
	/** Callback when retry is clicked (for error state) */
	onRetry?: () => void;
	/** Agent ID to display in tooltip when connected */
	agentId?: string | null;
}

let { status, size = 14, show = true, onRetry, agentId }: SessionStatusIndicatorProps = $props();

const presentation = $derived(resolveSessionStatusIndicatorPresentation(status, show));
</script>

{#if presentation !== "none"}
	<div class="flex items-center justify-center min-w-5 min-h-5">
		{#if presentation === "connected"}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<div class="animate-in zoom-in-50 duration-300 text-success">
						<IconCircleCheckFilled {size} />
					</div>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<div class="space-y-1.5">
						<div class="font-medium">{"Thread is connected"}</div>
						{#if agentId}
							<table class="text-xs">
								<tbody>
									<tr>
										<td class="pr-3 text-muted-foreground">Agent ID:</td>
										<td class="font-mono">{agentId}</td>
									</tr>
								</tbody>
							</table>
						{/if}
					</div>
				</Tooltip.Content>
			</Tooltip.Root>
		{:else if presentation === "error"}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="hover:opacity-80 transition-opacity animate-in fade-in duration-150"
						style="color: {Colors.red};"
						onclick={() => onRetry?.()}
					>
						<IconAlertCircle {size} />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					{"Thread error - click to retry"}
				</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	</div>
{/if}
