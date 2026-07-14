<script lang="ts">
	import { Tooltip } from "bits-ui";

	import { LoadingIcon, HugeiconsIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";

	import { resolveAgentPanelStatusIconPresentation } from "./agent-panel-status-icon-state.js";
	import type { AgentSessionStatus } from "./types.js";

	interface Props {
		/** Mapped session status for display */
		status?: AgentSessionStatus;
		/** Retained for API compatibility; connecting states show no loading affordance. */
		isConnecting?: boolean;
		/** When true, show immediate feedback after the user clicks retry */
		isRetrying?: boolean;
		/** Size of the indicator icon in pixels */
		size?: number;
		/** Tooltip text for warming/connecting state */
		warmingLabel?: string;
		/** Tooltip text for retrying state */
		retryingLabel?: string;
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
		isRetrying = false,
		size = 14,
		warmingLabel = "Preparing",
		retryingLabel = "Retrying",
		connectedLabel = "Connected",
		errorLabel = "Error",
		agentId = null,
		onRetry,
	}: Props = $props();

	const presentation = $derived(
		resolveAgentPanelStatusIconPresentation({ status, isConnecting, isRetrying })
	);
</script>

{#if presentation !== "none"}
	<Tooltip.Provider delayDuration={0}>
		<div class="flex size-5 shrink-0 items-center justify-center">
			{#if presentation === "loading"}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<div class="animate-in fade-in duration-150">
							<LoadingIcon
								{size}
								aria-label={isRetrying ? retryingLabel : warmingLabel}
							/>
						</div>
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content
							class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
							sideOffset={4}
						>
							{isRetrying ? retryingLabel : warmingLabel}
						</Tooltip.Content>
					</Tooltip.Portal>
				</Tooltip.Root>
			{:else if presentation === "connected"}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<div
							class="animate-in zoom-in-50 duration-300 {status === 'idle'
								? 'text-muted-foreground'
								: 'text-success'}"
						>
							<HugeiconsIcon
								name="check-circle-filled"
								style={`width: ${size}px; height: ${size}px;`}
							/>
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
				{:else if presentation === "error"}
					<Tooltip.Root>
						<Tooltip.Trigger>
						<button
							type="button"
							class="inline-flex size-5 items-center justify-center rounded transition-colors animate-in fade-in duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
							style="color: {Colors.red};"
							aria-label={errorLabel}
							onclick={() => onRetry?.()}
						>
							<HugeiconsIcon
								name="alert"
								style={`width: ${size}px; height: ${size}px;`}
							/>
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
