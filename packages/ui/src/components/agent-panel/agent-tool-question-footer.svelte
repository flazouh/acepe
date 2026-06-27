<script lang="ts">
	import { Check, XCircle } from "../icons/index.js";

	interface Props {
		hasSelections?: boolean;
		cancelLabel?: string;
		submitLabel?: string;
		onCancel?: () => void;
		onSubmit?: () => void;
	}

	let {
		hasSelections = false,
		cancelLabel = "Cancel",
		submitLabel = "Submit",
		onCancel,
		onSubmit,
	}: Props = $props();
</script>

<div class="question-footer">
	<div class="question-footer-left"></div>
	<div class="question-footer-right">
		<button type="button" class="question-footer-btn" onclick={onCancel}>
			<XCircle size={12} weight="fill" class="shrink-0" />
			{cancelLabel}
		</button>
		<button
			type="button"
			class="question-footer-btn question-footer-btn--submit"
			disabled={!hasSelections}
			onclick={onSubmit}
		>
			<Check size={12} weight="bold" class="shrink-0" />
			{submitLabel}
		</button>
	</div>
</div>

<style>
	.question-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1px;
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.question-footer-left,
	.question-footer-right {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	.question-footer-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 4px 8px;
		font: inherit;
		font-size: 0.875rem;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.question-footer-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}

	.question-footer-btn:disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.question-footer-btn--submit:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}
</style>
