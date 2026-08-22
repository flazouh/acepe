<script lang="ts">
	import {
		canDecreaseFont,
		canIncreaseFont,
		type SettingsModalViewModel,
	} from "./settings-modal-state.js";

	let {
		model,
		onOpen,
		onClose,
		onDecreaseUiFont,
		onIncreaseUiFont,
		onDecreaseCodeFont,
		onIncreaseCodeFont,
	}: {
		model: SettingsModalViewModel;
		onOpen: () => void;
		onClose: () => void;
		onDecreaseUiFont: () => void;
		onIncreaseUiFont: () => void;
		onDecreaseCodeFont: () => void;
		onIncreaseCodeFont: () => void;
	} = $props();

	const canDecreaseUi = $derived(canDecreaseFont(model.uiFontSize, model.uiMin));
	const canIncreaseUi = $derived(canIncreaseFont(model.uiFontSize, model.uiMax));
	const canDecreaseCode = $derived(canDecreaseFont(model.codeFontSize, model.codeMin));
	const canIncreaseCode = $derived(canIncreaseFont(model.codeFontSize, model.codeMax));
</script>

<div
	class="flex min-h-0 flex-1 flex-col gap-3 p-3"
	data-testid="settings-shell"
	data-ui-font-size={model.uiFontSize}
	data-code-font-size={model.codeFontSize}
>
	<button
		type="button"
		data-testid="settings-open"
		class="self-start rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-accent/50"
		onclick={() => onOpen()}
	>
		{model.openLabel}
	</button>

	{#if model.open}
		<div
			data-testid="settings-modal"
			data-ui-font-size={model.uiFontSize}
			data-code-font-size={model.codeFontSize}
			role="dialog"
			aria-labelledby="settings-modal-title"
			class="flex min-h-0 flex-1 flex-col gap-4 rounded-xl border border-border/60 bg-card p-4"
		>
			<div class="flex items-start justify-between gap-3">
				<h1 id="settings-modal-title" class="text-sm font-medium">{model.title}</h1>
				<button
					type="button"
					data-testid="settings-close"
					class="rounded-lg border border-border/60 px-2 py-1 text-xs hover:bg-accent/50"
					onclick={() => onClose()}
				>
					{model.closeLabel}
				</button>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="text-xs font-medium">{model.uiFontLabel}</p>
						<p class="text-[11px] text-muted-foreground">{model.uiFontDescription}</p>
					</div>
					<div class="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5">
						<button
							type="button"
							data-testid="settings-ui-font-decrease"
							aria-label="Decrease interface font size"
							disabled={!canDecreaseUi}
							onclick={() => onDecreaseUiFont()}
							class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						>
							-
						</button>
						<span data-testid="settings-ui-font-value" class="w-9 text-center text-[13px] font-medium tabular-nums">
							{model.uiFontSize}
						</span>
						<button
							type="button"
							data-testid="settings-ui-font-increase"
							aria-label="Increase interface font size"
							disabled={!canIncreaseUi}
							onclick={() => onIncreaseUiFont()}
							class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						>
							+
						</button>
					</div>
				</div>

				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="text-xs font-medium">{model.codeFontLabel}</p>
						<p class="text-[11px] text-muted-foreground">{model.codeFontDescription}</p>
					</div>
					<div class="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5">
						<button
							type="button"
							data-testid="settings-code-font-decrease"
							aria-label="Decrease code font size"
							disabled={!canDecreaseCode}
							onclick={() => onDecreaseCodeFont()}
							class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						>
							-
						</button>
						<span data-testid="settings-code-font-value" class="w-9 text-center text-[13px] font-medium tabular-nums">
							{model.codeFontSize}
						</span>
						<button
							type="button"
							data-testid="settings-code-font-increase"
							aria-label="Increase code font size"
							disabled={!canIncreaseCode}
							onclick={() => onIncreaseCodeFont()}
							class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
						>
							+
						</button>
					</div>
				</div>
			</div>

			<section class="flex min-h-0 flex-1 flex-col gap-2">
				<p class="text-xs font-medium">{model.reviewPreviewLabel}</p>
				<div
					data-testid="review-modal-preview"
					class="rounded-lg border border-border/60 bg-background p-3 text-sm"
				>
					{model.reviewPreviewText}
				</div>
				<p class="text-xs font-medium">{model.diffPreviewLabel}</p>
				<pre
					data-testid="diff-preview"
					class="app-code-font overflow-auto rounded-lg border border-border/60 bg-background p-3"
				>{model.diffPreviewText}</pre>
			</section>
		</div>
	{/if}
</div>
