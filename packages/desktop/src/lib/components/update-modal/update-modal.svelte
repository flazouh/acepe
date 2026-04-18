<script lang="ts">
import { BrandLockup, BrandShaderBackground, TextShimmer } from "@acepe/ui";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
export type UpdateState = "checking" | "downloading" | "error";

interface Props {
	updateState: UpdateState;
	progress: number;
	total: number | undefined;
	errorMessage: string | null;
	onRetry: () => void;
}

let { updateState, progress, total, errorMessage, onRetry }: Props = $props();

const downloadPercent = $derived(
	total != null && total > 0 ? Math.min(Math.round((progress / total) * 100), 100) : null
);

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<div
	class="fixed inset-0 z-[var(--app-blocking-z)] flex items-center justify-center"
	role="dialog"
	aria-modal="true"
	aria-label="Updating Acepe"
>
	<!-- Full-screen shader backdrop -->
	<BrandShaderBackground />

	<!-- Compact modal card -->
	<div class="update-card">
		<!-- Logo row -->
		<BrandLockup
			class="gap-2.5"
			markClass="h-5 w-5"
			wordmarkClass="text-[13px] text-white/80"
		/>

		<!-- State content -->
		<div class="mt-5">
			{#if updateState === "checking"}
				<div class="flex flex-col gap-3">
					<p class="text-[15px] font-medium text-white">{"Checking for updates"}</p>
					<div class="flex items-center gap-2.5">
						<Spinner class="size-3.5 text-white/40" />
						<span class="text-xs text-white/40">{"Looking for the latest version..."}</span>
					</div>
				</div>
			{:else if updateState === "downloading"}
				<div class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<TextShimmer class="text-[15px] font-medium text-white">
							{"Downloading update"}
						</TextShimmer>
						{#if downloadPercent != null}
							<span class="text-xs tabular-nums text-white/50">{downloadPercent}%</span>
						{/if}
					</div>

					<!-- Progress track -->
					<div class="update-progress-track">
						{#if downloadPercent != null}
							<div class="update-progress-bar" style="width: {downloadPercent}%"></div>
						{:else}
							<div class="update-progress-bar-indeterminate"></div>
						{/if}
					</div>

					<!-- Download stats -->
					<div class="flex items-center justify-between text-xs text-white/40">
						<span class="tabular-nums">
							{formatBytes(progress)}{#if total}
								/ {formatBytes(total)}{/if}
						</span>
						{#if downloadPercent != null && downloadPercent >= 100}
							<span>{"Installing update..."}</span>
						{/if}
					</div>
				</div>
			{:else if updateState === "error"}
				<div class="flex flex-col gap-3">
					<p class="text-[15px] font-medium text-white">{"Update failed"}</p>
					<p class="text-xs leading-relaxed text-white/40">
						{errorMessage ?? "Something went wrong while updating. Please check your connection and try again."}
					</p>
					<div class="mt-1">
						<Button
							variant="default"
							size="sm"
							onclick={onRetry}
							class="group gap-1.5 h-7 px-3 text-xs"
						>
							{"Retry"}
							<RefreshCw class="size-3 transition-transform duration-200 group-hover:rotate-180" />
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.update-card {
		position: relative;
		z-index: 10;
		width: 340px;
		padding: 1.25rem 1.5rem;
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(16, 16, 16, 0.92);

		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.3),
			0 8px 40px rgba(0, 0, 0, 0.5);
	}

	.update-progress-track {
		height: 3px;
		width: 100%;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}

	.update-progress-bar {
		height: 100%;
		border-radius: 9999px;
		background: var(--primary);
		transition: width 300ms ease;
	}

	.update-progress-bar-indeterminate {
		height: 100%;
		width: 40%;
		border-radius: 9999px;
		background: var(--primary);
		animation: indeterminate 1.5s ease-in-out infinite;
	}

	@keyframes indeterminate {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}
</style>
