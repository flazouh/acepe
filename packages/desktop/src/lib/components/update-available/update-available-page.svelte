<script lang="ts">
import { BrandLockup, BrandSurface, IrisCard, TextShimmer, SegmentedProgressBar } from "@acepe/ui";
import { RoundedIcon } from "@acepe/ui";
import { onMount } from "svelte";
import {
	isUpdaterInstallInProgress,
	type UpdaterBannerState,
} from "$lib/components/main-app-view/logic/updater-state.js";
import { BrandThemeToggle } from "$lib/components/theme/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
const UPDATE_PROGRESS_SEGMENT_COUNT = 96;

interface Props {
	updaterState: UpdaterBannerState;
	onRetry: () => void;
	onDismiss?: () => void;
}

let { updaterState, onRetry, onDismiss }: Props = $props();

const downloadPercent = $derived(
	updaterState.kind === "installing"
		? 100
		: updaterState.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
			? Math.min(Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100), 100)
			: null
);

const isInstalling = $derived(isUpdaterInstallInProgress(updaterState));

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMount(() => {
	if (onDismiss) {
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onDismiss();
			}
		};
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}
});
</script>

<!-- Shared brand surface shell (same shell as onboarding). -->
<BrandSurface variant="luminar">
	{#snippet topRight()}
		<BrandThemeToggle />
	{/snippet}

	<IrisCard class="update-card relative z-10 w-full max-w-sm rounded-xl">
		<div class="flex flex-col gap-3 p-4">
			<div class="flex items-center justify-between gap-3">
				<BrandLockup
					class="gap-2.5"
					markClass="h-7 w-7"
					wordmarkClass="text-[15px] font-medium tracking-tight text-foreground"
				/>
				{#if updaterState.kind === "available" || updaterState.kind === "downloading" || updaterState.kind === "installing"}
					<span
						class="rounded-full bg-white/45 px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-white/60"
					>
						v{updaterState.version}
					</span>
				{/if}
			</div>

			{#if updaterState.kind === "checking"}
				<div class="flex flex-col gap-2">
					<p class="text-[13px] font-semibold tracking-tight text-foreground">Checking for updates</p>
					<div class="flex items-center gap-2">
						<Spinner class="text-muted-foreground/50" size={12} />
						<span class="text-[11px] text-muted-foreground/70">Looking for the latest version…</span>
					</div>
				</div>
			{:else if updaterState.kind === "available"}
				<div class="flex flex-col gap-2">
					<p class="text-[13px] font-semibold tracking-tight text-foreground">New version ready</p>
					<p class="text-[11px] leading-relaxed text-muted-foreground/70">
						Download and install v{updaterState.version} to get the latest improvements.
					</p>
				</div>
			{:else if updaterState.kind === "downloading" || updaterState.kind === "installing"}
				<div class="flex flex-col gap-2.5">
					<div class="flex items-baseline justify-between gap-3">
						<TextShimmer class="text-[13px] font-semibold tracking-tight text-foreground">
							{isInstalling ? "Installing update…" : "Downloading update…"}
						</TextShimmer>
						{#if downloadPercent !== null}
							<span class="font-mono text-[11px] tabular-nums text-muted-foreground/70">
								{downloadPercent}%
							</span>
						{/if}
					</div>

					<SegmentedProgressBar
						ariaLabel={isInstalling ? "Installing update" : "Downloading update"}
						label=""
						percent={downloadPercent !== null ? downloadPercent : 0}
						segmentCount={UPDATE_PROGRESS_SEGMENT_COUNT}
						showPercent={false}
						variant="downloadFillWidth"
					/>

					{#if updaterState.kind === "downloading"}
						<div class="flex items-center justify-between text-[11px] text-muted-foreground/55">
							<span class="tabular-nums">
								{formatBytes(updaterState.downloadedBytes)}{#if updaterState.totalBytes} / {formatBytes(updaterState.totalBytes)}{/if}
							</span>
							{#if isInstalling}
								<span>Installing update…</span>
							{/if}
						</div>
					{:else}
						<div class="flex items-center justify-end text-[11px] text-muted-foreground/55">
							<span>Installing update…</span>
						</div>
					{/if}
				</div>
			{:else if updaterState.kind === "error"}
				<div class="flex flex-col gap-2">
					<p class="text-[13px] font-semibold tracking-tight text-foreground">Update failed</p>
					<p class="text-[11px] leading-relaxed text-muted-foreground/70">
						{updaterState.message}
					</p>
					<div>
						<Button
							variant="default"
							size="sm"
							onclick={onRetry}
							class="group gap-1.5 h-7 px-3 text-[11px]"
						>
							Retry
							<RoundedIcon name="refresh" class="size-3 transition-transform duration-200 group-hover:rotate-180" />
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</IrisCard>
</BrandSurface>

<style>
	:global(.update-card) {
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.08),
			0 20px 60px rgba(0, 0, 0, 0.35);
		animation: card-enter 0.4s ease-out;
	}

	@keyframes card-enter {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
