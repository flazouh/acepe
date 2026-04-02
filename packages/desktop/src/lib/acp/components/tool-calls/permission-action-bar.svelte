<script lang="ts">
import { Button } from "@acepe/ui/button";
import CheckCircle from "phosphor-svelte/lib/CheckCircle";
import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
import XCircle from "phosphor-svelte/lib/XCircle";
import * as m from "$lib/paraglide/messages.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";

interface Props {
	permission: PermissionRequest;
	compact?: boolean;
}

let { permission, compact = false }: Props = $props();

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

<div class="flex w-full items-center gap-1">
	<Button variant="toolbar" size="toolbar" class="flex-1 justify-center" onclick={handleReject}>
		<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
		{#if !compact}<span>{m.permission_deny()}</span>{/if}
	</Button>

	<Button variant="toolbar" size="toolbar" class="flex-1 justify-center" onclick={handleAllowOnce}>
		<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
		{#if !compact}<span>{m.permission_allow()}</span>{/if}
	</Button>

	{#if hasAlwaysOption}
		<Button variant="toolbar" size="toolbar" class="flex-1 justify-center" onclick={handleAlwaysAllow}>
			<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
			{#if !compact}<span>{m.permission_always_allow()}</span>{/if}
		</Button>
	{/if}
</div>
