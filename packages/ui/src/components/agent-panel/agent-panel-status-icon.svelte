<script lang="ts">
	import { IconAlertCircle, IconCircleCheckFilled } from "@tabler/icons-svelte";
	import { Tooltip } from "bits-ui";

	import { LoadingIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";

	import type { AgentSessionStatus } from "./types.js";

	interface Props {
		/** Mapped session status for display */
		status?: AgentSessionStatus;
		/** When true, show a spinner (e.g. connecting before session exists) */
		isConnecting?: boolean;
		/** Size of the indicator icon in pixels */
		size?: number;
		/** Tooltip text for warming/connecting state */
		warmingLabel?: string;
		/** Tooltip text for connected state */
		connectedLabel?: string;
		/** Tooltip text for error state */
		errorLabel?: string;
		/** Agent ID shown in connected tooltip */
		agentId?: string | null;
		/** Callback when error icon is clicked (retry) */
		onRetry?: () => void;
	}

	let {
		status = "empty",
		isConnecting = false,
		size = 14,
		warmingLabel = "Preparing",
		connectedLabel = "Connected",
		errorLabel = "Error",
		agentId = null,
		onRetry,
	}: Props = $props();

	const shouldShow = $derived(status !== "empty" || isConnecting);
</script>

{#if shouldShow}
	<Tooltip.Provider delayDuration={0}>
		<div class="flex h-7 w-7 shrink-0 items-center justify-center">
			{#if isConnecting || status === "warming" || status === "running"}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<div class="animate-in fade-in duration-150">
							<LoadingIcon style="width: {size}px; height: {size}px;" />
						</div>
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content
							class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
							sideOffset={4}
						>
							{warmingLabel}
						</Tooltip.Content>
					</Tooltip.Portal>
				</Tooltip.Root>
			{:else if status === "connected" || status === "done" || status === "idle"}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<div
							class="animate-in zoom-in-50 duration-300 {status === 'idle'
								? 'text-muted-foreground'
								: 'text-success'}"
						>
							<IconCircleCheckFilled {size} />
						</div>
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content
							class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
							sideOffset={4}
						>
							<div class="space-y-1.5">
								<div class="font-medium">{connectedLabel}</div>
								{#if agentId}
									<table class="text-sm">
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
					</Tooltip.Portal>
				</Tooltip.Root>
			{:else if status === "error"}
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
					<Tooltip.Portal>
						<Tooltip.Content
							class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
							sideOffset={4}
						>
							{errorLabel}
						</Tooltip.Content>
					</Tooltip.Portal>
				</Tooltip.Root>
			{/if}
		</div>
	</Tooltip.Provider>
{/if}
