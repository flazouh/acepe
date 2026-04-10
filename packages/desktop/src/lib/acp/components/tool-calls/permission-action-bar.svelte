<script lang="ts">
import { FilePathBadge } from "@acepe/ui/file-path-badge";
import { Button } from "@acepe/ui/button";
import { CheckCircle, ShieldCheck, ShieldWarning, XCircle } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import { getPermissionStore } from "../../store/permission-store.svelte.js";
import type { PermissionRequest } from "../../types/permission.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";
import { extractCompactPermissionDisplay } from "./permission-display.js";

interface Props {
	permission: PermissionRequest;
	compact?: boolean;
	inline?: boolean;
	hideHeader?: boolean;
	projectPath?: string | null;
}

let {
	permission,
	compact = false,
	inline = false,
	hideHeader = false,
	projectPath = null,
}: Props = $props();

const permissionStore = getPermissionStore();

const hasAlwaysOption = $derived(permission.always && permission.always.length > 0);
const compactDisplay = $derived(extractCompactPermissionDisplay(permission, projectPath));

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
const buttonClass = "justify-center shrink-0";
</script>

<div class="flex min-w-0 flex-col gap-1" class:w-full={!inline}>
	{#snippet permissionSummary()}
		<div class="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
			<ShieldWarning weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
			<span class="shrink-0 font-medium text-muted-foreground">{compactDisplay.label}</span>
			{#if compactDisplay.filePath}
				<div class="min-w-0 flex-1">
					<FilePathBadge filePath={compactDisplay.filePath} interactive={false} />
				</div>
			{:else if compactDisplay.command}
				<code class="min-w-0 flex-1 truncate font-mono text-foreground/70">$ {compactDisplay.command}</code>
			{/if}
		</div>
	{/snippet}

	{#if !hideHeader}
		{@render permissionSummary()}
	{/if}

	<div class="flex items-center justify-end gap-1" class:w-full={!inline && !compact}>
		<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={handleReject}>
			<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
			<span>{m.permission_deny()}</span>
		</Button>

		{#if hasAlwaysOption}
			<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={handleAlwaysAllow}>
				<ShieldCheck weight="fill" class="size-3 shrink-0" style="color: {purpleColor}" />
				<span>{m.permission_always_allow()}</span>
			</Button>
		{/if}

		<Button variant="toolbar" size="toolbar" class={buttonClass} onclick={handleAllowOnce}>
			<CheckCircle weight="fill" class="size-3 shrink-0" style="color: {greenColor}" />
			<span>{m.permission_allow()}</span>
		</Button>
	</div>
</div>
