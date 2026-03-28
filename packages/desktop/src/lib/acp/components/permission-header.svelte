<script lang="ts">
	import CheckCircle from "phosphor-svelte/lib/CheckCircle";
	import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
	import ShieldWarning from "phosphor-svelte/lib/ShieldWarning";
	import XCircle from "phosphor-svelte/lib/XCircle";
	import * as m from "$lib/paraglide/messages.js";
	import { getPermissionStore } from "../store/permission-store.svelte.js";
	import type { PermissionRequest } from "../types/permission.js";
	import { COLOR_NAMES, Colors } from "../utils/colors.js";
	import { createLogger } from "../utils/logger.js";
	import {
		extractPermissionCommand,
		extractPermissionFilePath,
	} from "./tool-calls/permission-display.js";
	import AnimatedChevron from "./animated-chevron.svelte";

	interface Props {
		sessionId: string;
	}

	const { sessionId }: Props = $props();

	const permissionStore = getPermissionStore();
	const logger = createLogger({ id: "permission-header", name: "PermissionHeader" });

	const permissions = $derived(permissionStore.getForSession(sessionId));
	const current = $derived<PermissionRequest | null>(
		permissions.length > 0 ? permissions[0] : null
	);
	const totalCount = $derived(permissions.length);
	const hasMultiple = $derived(totalCount > 1);

	const hasAlwaysOption = $derived(
		current ? current.always && current.always.length > 0 : false
	);

	const command = $derived(current ? extractPermissionCommand(current) : null);
	const filePath = $derived(current ? extractPermissionFilePath(current) : null);

	let isExpanded = $state(false);

	const greenColor = "var(--success)";
	const redColor = Colors[COLOR_NAMES.RED];
	const purpleColor = Colors[COLOR_NAMES.PURPLE];

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	function handleReject() {
		if (!current) return;
		void permissionStore.reply(current.id, "reject").match(
			() => {},
			(err) => logger.error("Failed to reject permission", { error: err })
		);
	}

	function handleAllowOnce() {
		if (!current) return;
		void permissionStore.reply(current.id, "once").match(
			() => {},
			(err) => logger.error("Failed to allow permission", { error: err })
		);
	}

	function handleAlwaysAllow() {
		if (!current) return;
		void permissionStore.reply(current.id, "always").match(
			() => {},
			(err) => logger.error("Failed to always-allow permission", { error: err })
		);
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}
</script>

{#if current}
	<div class="w-full px-5 mb-2">
		<!-- Expanded details panel (above the bar) -->
		{#if isExpanded}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<div class="flex flex-col gap-1 px-3 py-2">
					<!-- Permission label -->
					<div class="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
						<ShieldWarning weight="fill" class="size-3 shrink-0 text-primary" />
						<span class="font-medium text-foreground">{current.permission}</span>
					</div>

					<!-- File path -->
					{#if filePath}
						<div class="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground min-w-0">
							<span class="shrink-0">File:</span>
							<code class="truncate font-mono text-foreground/70 min-w-0">{filePath}</code>
						</div>
					{/if}

					<!-- Command -->
					{#if command}
						<div class="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground min-w-0">
							<span class="shrink-0">Command:</span>
							<code class="truncate font-mono text-foreground/70 min-w-0">$ {command}</code>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Main bar -->
		<div
			class="w-full flex items-center justify-between px-3 py-1.5 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<!-- Left side: expand toggle + permission summary -->
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<button
					type="button"
					class="flex items-center gap-1 shrink-0 cursor-pointer bg-transparent border-none p-0"
					onclick={toggleExpanded}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							toggleExpanded();
						}
					}}
				>
					<ShieldWarning weight="fill" class="size-3.5 shrink-0 text-primary" />
					<AnimatedChevron isOpen={isExpanded} class="size-3 text-muted-foreground" />
				</button>

				<span class="font-medium text-foreground truncate">
					{current.permission}
				</span>

				{#if filePath}
					<code class="truncate font-mono text-[0.625rem] text-muted-foreground min-w-0">{filePath}</code>
				{:else if command}
					<code class="truncate font-mono text-[0.625rem] text-muted-foreground min-w-0">$ {command}</code>
				{/if}

				{#if hasMultiple}
					<span class="shrink-0 text-muted-foreground text-[0.625rem]">
						{m.permission_header_count({ current: "1", total: String(totalCount) })}
					</span>
				{/if}
			</div>

			<!-- Right side: action buttons -->
			<div
				class="flex items-center gap-1.5 shrink-0"
				style="--permission-green: {greenColor}; --permission-red: {redColor}; --permission-purple: {purpleColor};"
			>
				<button type="button" class="permission-btn" onclick={handleReject}>
					<XCircle weight="fill" class="size-3.5 shrink-0" style="color: {redColor}" />
					<span>{m.permission_deny()}</span>
				</button>

			<button
				use:focusOnMount
				type="button"
				class="permission-btn"
				onclick={handleAllowOnce}
			>
					<CheckCircle weight="fill" class="size-3.5 shrink-0" style="color: {greenColor}" />
					<span>{m.permission_allow()}</span>
				</button>

				{#if hasAlwaysOption}
					<button type="button" class="permission-btn" onclick={handleAlwaysAllow}>
						<ShieldCheck weight="fill" class="size-3.5 shrink-0" style="color: {purpleColor}" />
						<span>{m.permission_always_allow()}</span>
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
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

	.permission-btn:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
</style>
