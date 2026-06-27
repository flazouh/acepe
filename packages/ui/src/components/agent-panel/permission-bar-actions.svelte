<script lang="ts">
	import { CheckCircle, ShieldCheck, XCircle } from "../icons/index.js";

	import { Button } from "../button/index.js";
	import { COLOR_NAMES, Colors } from "../../lib/colors.js";

	interface Props {
		allowLabel?: string;
		alwaysAllowLabel?: string;
		denyLabel?: string;
		showAlwaysAllow?: boolean;
		align?: "start" | "end";
		selectedReply?: "once" | "always" | "reject" | null;
		onAllow: () => void;
		onAlwaysAllow?: () => void;
		onDeny: () => void;
	}

	let {
		allowLabel = "Allow",
		alwaysAllowLabel = "Always allow",
		denyLabel = "Deny",
		showAlwaysAllow = false,
		align = "end",
		selectedReply = null,
		onAllow,
		onAlwaysAllow,
		onDeny,
	}: Props = $props();

	const buttonClass = "justify-center shrink-0";
	const mutedIconColor = "var(--muted-foreground)";
	const denyIconColor = $derived(
		selectedReply === null || selectedReply === "reject" ? "var(--destructive)" : mutedIconColor
	);
	const alwaysIconColor = $derived(
		selectedReply === null || selectedReply === "always" ? Colors[COLOR_NAMES.PURPLE] : mutedIconColor
	);
	const allowIconColor = $derived(
		selectedReply === null || selectedReply === "once" ? "var(--success)" : mutedIconColor
	);
	const wrapperClass = $derived(
		align === "start"
			? "inline-flex flex-wrap items-center justify-start gap-1"
			: "flex w-full flex-wrap items-center justify-end gap-1"
	);
</script>

{#if selectedReply === null}
	<div class={wrapperClass}>
		<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onDeny}>
			<XCircle weight="fill" class="size-3 shrink-0" style="color: {denyIconColor}" />
			<span>{denyLabel}</span>
		</Button>

		{#if showAlwaysAllow && onAlwaysAllow}
			<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onAlwaysAllow}>
				<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {alwaysIconColor}" />
				<span>{alwaysAllowLabel}</span>
			</Button>
		{/if}

		<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onAllow}>
			<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {allowIconColor}" />
			<span>{allowLabel}</span>
		</Button>
	</div>
{/if}
