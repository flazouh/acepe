<script lang="ts">
	import { TextShimmer } from "@acepe/ui";
	import {
		GrainGradientShapes,
		type GrainGradientUniforms,
		getShaderColorFromString,
		getShaderNoiseTexture,
		grainGradientFragmentShader,
		ShaderFitOptions,
		ShaderMount,
	} from "@paper-design/shaders";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import { onDestroy, onMount } from "svelte";
	import {
		isUpdaterInstallInProgress,
		type UpdaterBannerState,
	} from "$lib/components/main-app-view/logic/updater-state.js";
	import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import * as m from "$lib/paraglide/messages.js";
	import splashLogo from "../../../../../../assets/logo.svg?url";

	const UPDATE_PROGRESS_SEGMENT_COUNT = 96;

	interface Props {
		updaterState: UpdaterBannerState;
		onRetry: () => void;
		onDismiss?: () => void;
	}

	let { updaterState, onRetry, onDismiss }: Props = $props();

	let shaderContainer: HTMLDivElement | null = $state(null);
	let shaderMountRef: ShaderMount | null = null;

	const downloadPercent = $derived(
		updaterState.kind === "installing"
			? 100
			: updaterState.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
			? Math.min(
					Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100),
					100
				)
			: null
	);

	const isInstalling = $derived(
		isUpdaterInstallInProgress(updaterState)
	);

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	onMount(() => {
		void initShader();
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

	async function initShader() {
		if (!shaderContainer) return;

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
					getShaderColorFromString("#99FFE4"),
					getShaderColorFromString("#FFC799"),
					getShaderColorFromString("#99FFE4"),
					getShaderColorFromString("#FFC799"),
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
	}

	onDestroy(() => {
		shaderMountRef?.dispose();
	});
</script>

<!-- Shader background layer -->
<div class="absolute inset-0 bg-[#1a1a1a]">
	<div bind:this={shaderContainer} class="absolute inset-0"></div>
</div>

<!-- Content layer -->
<div
	class="relative z-10 mx-auto flex h-full w-full max-w-sm flex-col items-center justify-center px-5 py-4"
>
	<!-- Card -->
	<div class="update-card flex w-full flex-col overflow-hidden rounded-xl bg-background">
		<!-- Header -->
		<div class="flex flex-col gap-2 p-4 pb-3">
			<!-- Logo + version -->
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2.5">
					<img src={splashLogo} alt="" aria-hidden="true" class="h-7 w-7 object-contain" />
					<span class="text-[15px] font-semibold tracking-[0.18em] text-foreground">ACEPE</span>
				</div>
				{#if updaterState.kind === "available" || updaterState.kind === "downloading" || updaterState.kind === "installing"}
					<span class="rounded-full bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/50">
						v{updaterState.version}
					</span>
				{/if}
			</div>

			<!-- State content -->
			{#if updaterState.kind === "checking"}
				<div class="flex flex-col gap-1.5">
					<p class="text-[13px] font-medium text-foreground">{m.update_checking()}</p>
					<div class="flex items-center gap-2">
						<Spinner class="size-3 text-muted-foreground/40" />
						<span class="text-[11px] text-muted-foreground/50">{m.update_checking_description()}</span>
					</div>
				</div>
			{:else if updaterState.kind === "downloading" || updaterState.kind === "installing"}
				<div class="flex flex-col gap-2">
					<div class="flex items-baseline justify-between">
						<TextShimmer class="text-[13px] font-medium text-foreground">
							{isInstalling ? m.update_installing() : m.update_downloading()}
						</TextShimmer>
						{#if downloadPercent !== null}
							<span class="text-[11px] tabular-nums text-muted-foreground/50">{downloadPercent}%</span>
						{/if}
					</div>

					<VoiceDownloadProgress
						ariaLabel={isInstalling ? m.update_installing() : m.update_downloading()}
						compact={true}
						fillWidth={true}
						label=""
						percent={downloadPercent !== null ? downloadPercent : 0}
						segmentCount={UPDATE_PROGRESS_SEGMENT_COUNT}
						showPercent={false}
					/>

					{#if updaterState.kind === "downloading"}
						<div class="flex items-center justify-between text-[11px] text-muted-foreground/40">
							<span class="tabular-nums">
								{formatBytes(updaterState.downloadedBytes)}{#if updaterState.totalBytes} / {formatBytes(updaterState.totalBytes)}{/if}
							</span>
							{#if isInstalling}
								<span>{m.update_installing()}</span>
							{/if}
						</div>
					{:else}
						<div class="flex items-center justify-end text-[11px] text-muted-foreground/40">
							<span>{m.update_installing()}</span>
						</div>
					{/if}
				</div>
			{:else if updaterState.kind === "error"}
				<div class="flex flex-col gap-1.5">
					<p class="text-[13px] font-medium text-foreground">{m.update_error()}</p>
					<p class="text-[11px] leading-relaxed text-muted-foreground/50">
						{updaterState.message}
					</p>
					<div>
						<Button
							variant="default"
							size="sm"
							onclick={onRetry}
							class="group gap-1.5 h-6 px-2.5 text-[11px]"
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
