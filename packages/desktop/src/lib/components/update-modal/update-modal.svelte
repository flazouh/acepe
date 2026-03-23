<script lang="ts">
import { TextShimmer } from "@acepe/ui";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import {
	GrainGradientShapes,
	type GrainGradientUniforms,
	getShaderColorFromString,
	getShaderNoiseTexture,
	grainGradientFragmentShader,
	ShaderFitOptions,
	ShaderMount,
} from "@paper-design/shaders";
import { onDestroy, onMount } from "svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";

export type UpdateState = "checking" | "downloading" | "error";

interface Props {
	updateState: UpdateState;
	progress: number;
	total: number | undefined;
	errorMessage: string | null;
	onRetry: () => void;
}

let { updateState, progress, total, errorMessage, onRetry }: Props = $props();

let shaderContainer: HTMLDivElement | null = $state(null);
let shaderMountRef: ShaderMount | null = null;

const downloadPercent = $derived(
	total != null && total > 0 ? Math.min(Math.round((progress / total) * 100), 100) : null
);

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMount(() => {
	if (!shaderContainer) return;
	initShader();
});

async function initShader() {
	if (!shaderContainer) return;

	try {
		const noiseTexture = getShaderNoiseTexture();

		if (noiseTexture && !noiseTexture.complete) {
			await new Promise<void>((resolve, reject) => {
				noiseTexture.onload = () => resolve();
				noiseTexture.onerror = () => reject(new Error("Failed to load noise texture"));
			});
		}

		const containerWidth = shaderContainer.offsetWidth;
		const containerHeight = shaderContainer.offsetHeight;

		shaderMountRef = new ShaderMount(
			shaderContainer,
			grainGradientFragmentShader,
			{
				u_colorBack: getShaderColorFromString("#1a1a1a"),
				u_colors: [
					getShaderColorFromString("#F77E2C"),
					getShaderColorFromString("#ff8558"),
					getShaderColorFromString("#d69d5c"),
					getShaderColorFromString("#ffb380"),
				],
				u_colorsCount: 4,
				u_softness: 0.3,
				u_intensity: 0.8,
				u_noise: 0.15,
				u_shape: GrainGradientShapes.corners,
				u_noiseTexture: noiseTexture,
				u_fit: ShaderFitOptions.cover,
				u_scale: 1,
				u_rotation: 0,
				u_originX: 0.5,
				u_originY: 0.5,
				u_offsetX: 0,
				u_offsetY: 0,
				u_worldWidth: containerWidth,
				u_worldHeight: containerHeight,
			} satisfies Partial<GrainGradientUniforms>,
			{ alpha: false, premultipliedAlpha: false },
			0.5
		);
	} catch (error) {
		console.error("[UpdatePage] Failed to initialize shader:", error);
	}
}

onDestroy(() => {
	shaderMountRef?.dispose();
});
</script>

<div
	class="fixed inset-0 z-[9999] flex items-center justify-center"
	role="dialog"
	aria-modal="true"
	aria-label="Updating Acepe"
>
	<!-- Full-screen shader backdrop -->
	<div bind:this={shaderContainer} class="absolute inset-0 bg-[#1a1a1a]"></div>

	<!-- Compact modal card -->
	<div class="update-card">
		<!-- Logo row -->
		<div class="flex items-center gap-2.5">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 32 32"
				fill="none"
			>
				<rect
					x="5"
					y="5"
					width="6"
					height="22"
					rx="2"
					fill="currentColor"
					class="text-primary/30"
				/>
				<rect
					x="13"
					y="5"
					width="6"
					height="22"
					rx="2"
					fill="currentColor"
					class="text-primary/60"
				/>
				<rect x="21" y="5" width="6" height="22" rx="2" fill="currentColor" class="text-primary" />
			</svg>
			<span class="text-[13px] font-semibold tracking-wider text-white/80">ACEPE</span>
		</div>

		<!-- State content -->
		<div class="mt-5">
			{#if updateState === "checking"}
				<div class="flex flex-col gap-3">
					<p class="text-[15px] font-medium text-white">{m.update_checking()}</p>
					<div class="flex items-center gap-2.5">
						<Spinner class="size-3.5 text-white/40" />
						<span class="text-xs text-white/40">{m.update_checking_description()}</span>
					</div>
				</div>
			{:else if updateState === "downloading"}
				<div class="flex flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<TextShimmer class="text-[15px] font-medium text-white">
							{m.update_downloading()}
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
							<span>{m.update_installing()}</span>
						{/if}
					</div>
				</div>
			{:else if updateState === "error"}
				<div class="flex flex-col gap-3">
					<p class="text-[15px] font-medium text-white">{m.update_error()}</p>
					<p class="text-xs leading-relaxed text-white/40">
						{errorMessage ?? m.update_error_description()}
					</p>
					<div class="mt-1">
						<Button
							variant="default"
							size="sm"
							onclick={onRetry}
							class="group gap-1.5 h-7 px-3 text-xs"
						>
							{m.update_retry()}
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
