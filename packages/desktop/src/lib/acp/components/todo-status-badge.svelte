<script lang="ts">
import { TextShimmer } from "@acepe/ui";

import * as m from "$lib/paraglide/messages.js";
import type { TodoStatus } from "$lib/services/converted-session-types.js";

import {
	TODO_BADGE_BASE_CLASSES,
	TODO_ICON_CANCELLED,
	TODO_ICON_COMPLETED,
} from "../constants/todo-badge-html.js";

interface Props {
	status: TodoStatus;
	/**
	 * Whether the session is currently active (streaming/connected).
	 * When false, in_progress items show as paused instead of running.
	 */
	isLive?: boolean;
}

let { status, isLive = true }: Props = $props();

// Only show as running if both in_progress AND session is live
const isRunning = $derived(status === "in_progress" && isLive);
</script>

{#if status === "completed"}
	<span class={TODO_BADGE_BASE_CLASSES}>
		{@html TODO_ICON_COMPLETED}{m.plan_sidebar_todo_done()}</span
	>
{:else if status === "cancelled"}
	<span class={TODO_BADGE_BASE_CLASSES}>
		{@html TODO_ICON_CANCELLED}{m.plan_sidebar_todo_cancelled()}</span
	>
{:else if isRunning}
	<span class={TODO_BADGE_BASE_CLASSES}>
		<TextShimmer class="text-[0.6875rem]">{m.plan_sidebar_todo_running()}</TextShimmer></span
	>
{:else}
	<span class={TODO_BADGE_BASE_CLASSES}>{m.plan_sidebar_todo_pending()}</span>
{/if}
