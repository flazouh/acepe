<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { toastError, toastSuccess } from "$lib/components/ui/sonner/toast-bridge.js";
import {
	buildCopyButtonDisplayState,
	type CopyButtonVariant,
} from "./copy-button-state.js";
interface Props {
	/**
	 * Text to copy when clicked. Component handles clipboard + toast internally.
	 * Use this when you have the text available.
	 */
	text?: string;
	/**
	 * Alternative to text: function that returns text to copy (e.g. from a ref).
	 * Use when text is dynamic or computed.
	 */
	getText?: () => string | Promise<string>;
	/**
	 * Controlled mode: parent provides click handler and copied state.
	 * Use when parent has custom copy logic.
	 */
	onClick?: () => void;
	copied?: boolean;
	/** Style variant */
	variant?: CopyButtonVariant;
	/** Label text (for menu variant); shows next to icon */
	label?: string;
	/** When true, do not show the copy/check icon (menu variant: label only) */
	hideIcon?: boolean;
	/** Icon size in pixels */
	size?: number;
	/** Stop click propagation (useful when inside another clickable element) */
	stopPropagation?: boolean;
	/** Additional CSS classes */
	class?: string;
	/** Override default tooltip (default: "Copy" / "Copied!") */
	title?: string;
}

let {
	text,
	getText,
	onClick,
	copied: controlledCopied = false,
	variant = "inline",
	label,
	hideIcon = false,
	size = 14,
	stopPropagation = false,
	class: className = "",
	title: titleOverride,
}: Props = $props();

let internalCopied = $state(false);

const buttonState = $derived(
	buildCopyButtonDisplayState({
		variant,
		label,
		onClick,
		controlledCopied,
		internalCopied,
		titleOverride,
	})
);
const iconStyle = $derived(`width: ${size}px; height: ${size}px;`);

async function handleClick(event?: MouseEvent) {
	if (stopPropagation) {
		event?.stopPropagation?.();
	}
	if (buttonState.isControlled && onClick) {
		onClick();
		return;
	}

	let textToCopy: string;
	if (text !== undefined) {
		textToCopy = text;
	} else if (getText) {
		const result = getText();
		textToCopy = typeof result === "string" ? result : await result;
	} else {
		toastError("No content to copy");
		return;
	}

	if (!textToCopy.trim()) {
		toastError("No content to copy");
		return;
	}

	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(textToCopy),
		(e) => new Error(`Failed to copy: ${String(e)}`)
	)
		.map(() => {
			toastSuccess("Copied to clipboard");
			internalCopied = true;
			setTimeout(() => {
				internalCopied = false;
			}, 2000);
		})
		.mapErr((e) => {
			toastError("Failed to copy");
			console.error("Failed to copy:", e);
		});
}
</script>

<button
	onclick={(e) => handleClick(e)}
	title={buttonState.title}
	class="{buttonState.baseClass} {buttonState.colorClass} {className}"
	type="button"
>
	{#if !hideIcon}
		{#if buttonState.copied}
			<HugeiconsIcon name="check" class="shrink-0" style={iconStyle} />
		{:else}
			<HugeiconsIcon
				name="copy"
				class="shrink-0"
				style={iconStyle}
				data-testid="acp-copy-button-hugeicons-copy-icon"
			/>
		{/if}
	{/if}
	{#if buttonState.showLabel && label}
		<span class={buttonState.labelClass}>{label}</span>
	{/if}
</button>
