<script lang="ts">
	import { CheckCircle, ShieldCheck, XCircle } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	interface Props {
		allowLabel?: string;
		alwaysAllowLabel?: string;
		denyLabel?: string;
		showAlwaysAllow?: boolean;
		onAllow: () => void;
		onAlwaysAllow?: () => void;
		onDeny: () => void;
	}

	let {
		allowLabel = "Allow",
		alwaysAllowLabel = "Always allow",
		denyLabel = "Deny",
		showAlwaysAllow = false,
		onAllow,
		onAlwaysAllow,
		onDeny,
	}: Props = $props();

	const buttonClass = "justify-center shrink-0";
</script>

<div class="flex flex-wrap items-center justify-end gap-1">
	<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onDeny}>
		<XCircle weight="fill" class="size-3 shrink-0" style="color: var(--destructive)" />
		<span>{denyLabel}</span>
	</Button>

	{#if showAlwaysAllow && onAlwaysAllow}
		<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onAlwaysAllow}>
			<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: var(--primary)" />
			<span>{alwaysAllowLabel}</span>
		</Button>
	{/if}

	<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={onAllow}>
		<CheckCircle weight="fill" class="size-3 shrink-0" style="color: var(--success)" />
		<span>{allowLabel}</span>
	</Button>
</div>
