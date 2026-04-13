<script lang="ts">
import { IconCheck } from "@tabler/icons-svelte";
import { ResultAsync } from "neverthrow";
import { Copy } from "phosphor-svelte";
import { toastError, toastSuccess } from "$lib/components/ui/sonner/toast-bridge.js";
import * as m from "$lib/messages.js";

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
	variant?: "inline" | "footer" | "icon" | "menu" | "embedded";
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

const isControlled = $derived(onClick !== undefined);
const copied = $derived(isControlled ? (controlledCopied ?? false) : internalCopied);

const isFooter = $derived(variant === "footer");
const isIcon = $derived(variant === "icon");
const isMenu = $derived(variant === "menu");
const isEmbedded = $derived(variant === "embedded");
const isInlineWithLabel = $derived(variant === "inline" && Boolean(label));

const baseClass = $derived(
	isEmbedded
		? "h-7 w-7 inline-flex items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
		: isFooter
			? "inline-flex items-center justify-center p-0.5 rounded-full hover:bg-accent transition-colors"
			: isMenu
				? "w-full justify-start gap-2 flex items-center cursor-pointer border-none bg-transparent font-inherit text-inherit px-2 py-1 text-[11px] font-medium -mx-2 -my-1"
				: isInlineWithLabel
					? "inline-flex items-center gap-1 p-0 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 font-medium"
					: isIcon
						? "inline-flex items-center justify-center p-0.5 rounded transition-colors text-muted-foreground/50 hover:text-foreground"
						: "inline-flex items-center justify-center p-0.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 shrink-0"
);

const colorClass = $derived(
	copied ? "text-emerald-500" : isFooter ? "text-muted-foreground hover:text-foreground" : ""
);

async function handleClick(event?: MouseEvent) {
	if (stopPropagation) {
		event?.stopPropagation?.();
	}
	if (isControlled && onClick) {
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
		toastError(m.toast_no_content_to_copy());
		return;
	}

	if (!textToCopy.trim()) {
		toastError(m.toast_no_content_to_copy());
		return;
	}

	await ResultAsync.fromPromise(
		navigator.clipboard.writeText(textToCopy),
		(e) => new Error(`Failed to copy: ${String(e)}`)
	)
		.map(() => {
			toastSuccess(m.toast_copied_to_clipboard());
			internalCopied = true;
			setTimeout(() => {
				internalCopied = false;
			}, 2000);
		})
		.mapErr((e) => {
			toastError(m.message_input_copy_failed());
			console.error("Failed to copy:", e);
		});
}
</script>

<button
	onclick={(e) => handleClick(e)}
	title={copied ? "Copied!" : (titleOverride ?? m.button_copy())}
	class="{baseClass} {colorClass} {className}"
	type="button"
>
	{#if !hideIcon}
		{#if copied}
			<IconCheck {size} stroke={2} />
		{:else}
			<Copy {size} weight="fill" />
		{/if}
	{/if}
	{#if (isMenu || isInlineWithLabel) && label}
		<span class={isInlineWithLabel ? "truncate" : ""}>{label}</span>
	{/if}
</button>
