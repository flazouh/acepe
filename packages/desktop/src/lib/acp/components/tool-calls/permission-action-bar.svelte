<script lang="ts">
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
import XCircle from "phosphor-svelte/lib/XCircle";
import * as m from "$lib/paraglide/messages.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";

interface Props {
	permission: PermissionRequest;
}

let { permission }: Props = $props();

const permissionStore = getPermissionStore();

const hasAlwaysOption = $derived(permission.always && permission.always.length > 0);

function handleReject() {
	permissionStore.reply(permission.id, "reject");
}

function handleAllowOnce() {
	permissionStore.reply(permission.id, "once");
}

function handleAlwaysAllow() {
	permissionStore.reply(permission.id, "always");
}

const greenColor = "var(--success)";
const redColor = Colors[COLOR_NAMES.RED];
const purpleColor = Colors[COLOR_NAMES.PURPLE];
</script>

<div
	class="permission-actions"
	style="--permission-green: {greenColor}; --permission-red: {redColor}; --permission-purple: {purpleColor};"
>
	<button type="button" class="permission-btn deny" onclick={handleReject}>
		<XCircle weight="fill" class="size-3.5 shrink-0" style="color: {redColor}" />
		<span>{m.permission_deny()}</span>
	</button>

	<button type="button" class="permission-btn allow" onclick={handleAllowOnce}>
		<CheckCircle weight="fill" class="size-3.5 shrink-0" style="color: {greenColor}" />
		<span>{m.permission_allow()}</span>
	</button>

	{#if hasAlwaysOption}
		<button type="button" class="permission-btn always" onclick={handleAlwaysAllow}>
			<ShieldCheck weight="fill" class="size-3.5 shrink-0" style="color: {purpleColor}" />
			<span>{m.permission_always_allow()}</span>
		</button>
	{/if}
</div>

<style>
	.permission-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.permission-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 30%, transparent);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.permission-btn:hover {
		background: var(--muted);
	}
</style>
