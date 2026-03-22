<!--
  Notification Card - Individual notification popup card.

  Renders as a fixed-position overlay inside the main window.
  Self-manages auto-dismiss timer with hover pause.
  Fires action callbacks immediately (no animation delay race).

  Design: Acepe embedded pattern with terracotta accent strip,
  color-coded by notification type.
-->
<script lang="ts">
import { onMount } from "svelte";
import type {
	NotificationPayload,
	PopupActionId,
} from "$lib/notifications/notification-service.svelte.js";

interface Props {
	data: NotificationPayload;
	onAction: (actionId: PopupActionId) => void;
	onDismiss: () => void;
}

let { data, onAction, onDismiss }: Props = $props();

// ── Auto-dismiss timer ─────────────────────────────────────────────
// svelte-ignore state_referenced_locally
const autoDismissMs = data.autoDismissMs ?? 0;
const MIN_RESUME_MS = 800;

const ANIMATION_MS = 200; // must match slideOut CSS duration

let timer: ReturnType<typeof setTimeout> | null = null;
let timerStartedAt = 0;
let remaining = autoDismissMs;
let paused = $state(false);
let done = $state(false);

function clearTimer() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

function dismiss() {
	done = true;
	setTimeout(() => onDismiss(), ANIMATION_MS);
}

function startTimer() {
	if (!remaining || remaining <= 0) return;
	timerStartedAt = Date.now();
	timer = setTimeout(() => {
		if (done) return;
		dismiss();
	}, remaining);
}

function onMouseEnter() {
	if (!timer) return;
	paused = true;
	remaining -= Date.now() - timerStartedAt;
	remaining = Math.max(MIN_RESUME_MS, remaining);
	clearTimer();
}

function onMouseLeave() {
	paused = false;
	startTimer();
}

function handleAction(actionId: PopupActionId) {
	if (done) return;
	clearTimer();
	onAction(actionId);
	dismiss();
}

function handleClose() {
	if (done) return;
	clearTimer();
	dismiss();
}

onMount(() => {
	startTimer();
	return () => {
		if (timer) clearTimeout(timer);
	};
});

// ── Computed ────────────────────────────────────────────────────────
const typeLabel = $derived(
	data.type === "permission"
		? "Permission needed"
		: data.type === "question"
			? "Question"
			: "Task complete"
);
</script>

<div
	class="card"
	class:dismissed={done}
	data-type={data.type}
	role={data.type === "completion" ? "alert" : "alertdialog"}
	aria-label="{typeLabel}: {data.body}"
	onmouseenter={onMouseEnter}
	onmouseleave={onMouseLeave}
>
	<!-- Accent strip -->
	<div class="accent" data-type={data.type}></div>

	<div class="content">
		<!-- Header -->
		<div class="header">
			<div class="header-title">
				<span class="status-dot" data-type={data.type}></span>
				<span class="label">{typeLabel}</span>
			</div>
			<button
				class="close-btn"
				onclick={handleClose}
				aria-label="Dismiss notification"
			>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path
						d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>

		<!-- Body -->
		<div class="body">
			<div class="body-primary">{data.title}</div>
			<div class="body-secondary">{data.body}</div>
		</div>

		<!-- Actions -->
		<div class="actions">
			{#each data.actions as action (action.id)}
				<button
					class="action-btn"
					class:action-primary={action.variant === "primary"}
					class:action-secondary={action.variant === "secondary"}
					class:action-ghost={action.variant === "ghost"}
					onclick={() => handleAction(action.id)}
					aria-label={action.label}
				>
					{action.label}
				</button>
			{/each}
		</div>

		<!-- Progress bar (completions only) -->
		{#if autoDismissMs > 0}
			<div class="progress-track">
				<div
					class="progress-bar"
					class:paused
					style="animation-duration: {autoDismissMs}ms"
				></div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* ── Card Container ──────────────────────────────────────────── */
	.card {
		display: flex;
		overflow: hidden;
		border-radius: var(--radius, 10px);
		background: var(--background, #fafaf8);
		box-shadow:
			0 4px 24px -4px rgba(30, 24, 16, 0.18),
			0 2px 8px -2px rgba(30, 24, 16, 0.12),
			0 0 0 1px rgba(189, 182, 166, 0.25);
		border: 1px solid var(--border, #bdb6a6);
		animation: slideIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) forwards;
		transition:
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}

	.card:hover {
		box-shadow:
			0 6px 28px -4px rgba(30, 24, 16, 0.22),
			0 3px 10px -2px rgba(30, 24, 16, 0.15),
			0 0 0 1px rgba(189, 182, 166, 0.3);
		transform: translateX(-2px);
	}

	.card.dismissed {
		animation: slideOut 0.2s cubic-bezier(0.55, 0, 1, 0.45) forwards;
	}

	@keyframes slideIn {
		0% {
			opacity: 0;
			transform: translateX(24px);
		}
		60% {
			opacity: 1;
		}
		100% {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes slideOut {
		0% {
			opacity: 1;
			transform: translateX(0);
		}
		100% {
			opacity: 0;
			transform: translateX(16px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card.dismissed {
			animation: none !important;
			transition: opacity 0.15s ease !important;
		}
		.card.dismissed {
			opacity: 0;
		}
	}

	/* ── Accent Strip ────────────────────────────────────────────── */
	.accent {
		width: 3px;
		flex-shrink: 0;
		border-radius: var(--radius, 10px) 0 0 var(--radius, 10px);
	}

	.accent[data-type="permission"] {
		background: linear-gradient(180deg, #d97757 0%, #c4623f 100%);
	}

	.accent[data-type="question"] {
		background: linear-gradient(180deg, #e8a838 0%, #d49520 100%);
	}

	.accent[data-type="completion"] {
		background: linear-gradient(180deg, #6b9b6b 0%, #528a52 100%);
	}

	/* ── Content ─────────────────────────────────────────────────── */
	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/* ── Header ──────────────────────────────────────────────────── */
	.header {
		height: 28px;
		display: flex;
		align-items: center;
		border-bottom: 1px solid color-mix(in srgb, var(--border, #bdb6a6) 50%, transparent);
	}

	.header-title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: 10px;
		padding-right: 8px;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		color: var(--muted-foreground, #525252);
		user-select: none;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-dot[data-type="permission"] {
		background: var(--primary, #d97757);
		animation: dotPulse 2.5s ease-in-out infinite;
	}

	.status-dot[data-type="question"] {
		background: #e8a838;
	}

	.status-dot[data-type="completion"] {
		background: #6b9b6b;
	}

	@keyframes dotPulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--muted-foreground, #525252);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
		border-left: 1px solid color-mix(in srgb, var(--border, #bdb6a6) 30%, transparent);
		flex-shrink: 0;
	}

	.close-btn:hover {
		color: var(--foreground, #1a1a1a);
		background: color-mix(in srgb, var(--accent, #f5f5f0) 50%, transparent);
	}

	/* ── Body ────────────────────────────────────────────────────── */
	.body {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.body-primary {
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		font-weight: 500;
		color: var(--foreground, #1a1a1a);
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.body-secondary {
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		color: var(--muted-foreground, #525252);
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* ── Actions ─────────────────────────────────────────────────── */
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 12px 10px;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		padding: 0 12px;
		border-radius: 6px;
		border: none;
		font-family: var(--font-sans, sans-serif);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition:
			background 0.15s ease,
			transform 0.1s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.action-btn:active {
		transform: scale(0.97);
	}

	/* Primary: filled terracotta */
	.action-primary {
		color: var(--primary-foreground, white);
		background: var(--primary, #d97757);
	}

	.action-primary:hover {
		background: color-mix(in srgb, var(--primary, #d97757) 85%, black);
	}

	/* Secondary: bordered */
	.action-secondary {
		color: var(--foreground, #1a1a1a);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--border, #bdb6a6) 70%, transparent);
		padding: 0 10px;
		font-weight: 500;
	}

	.action-secondary:hover {
		background: color-mix(in srgb, var(--accent, #f5f5f0) 50%, transparent);
		border-color: var(--border, #bdb6a6);
	}

	/* Ghost: deny — subtle, red on hover */
	.action-ghost {
		color: var(--muted-foreground, #525252);
		background: transparent;
		border: 1px solid transparent;
		padding: 0 10px;
		font-weight: 500;
	}

	.action-ghost:hover {
		color: var(--destructive, #ef4444);
		background: color-mix(in srgb, var(--destructive, #ef4444) 8%, transparent);
		border-color: color-mix(in srgb, var(--destructive, #ef4444) 20%, transparent);
	}

	/* ── Progress Bar ────────────────────────────────────────────── */
	.progress-track {
		height: 2px;
		width: 100%;
		background: color-mix(in srgb, var(--border, #bdb6a6) 30%, transparent);
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: color-mix(in srgb, var(--primary, #d97757) 50%, transparent);
		border-radius: 0 1px 1px 0;
		transform-origin: left;
		animation: progressShrink linear forwards;
	}

	.progress-bar.paused {
		animation-play-state: paused;
	}

	@keyframes progressShrink {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}

	/* ── Dark mode ───────────────────────────────────────────────── */
	:global(.dark) .card {
		box-shadow:
			0 4px 24px -4px rgba(0, 0, 0, 0.5),
			0 2px 8px -2px rgba(0, 0, 0, 0.3),
			0 0 0 1px rgba(255, 255, 255, 0.06);
	}

	:global(.dark) .card:hover {
		box-shadow:
			0 6px 28px -4px rgba(0, 0, 0, 0.55),
			0 3px 10px -2px rgba(0, 0, 0, 0.35),
			0 0 0 1px rgba(255, 255, 255, 0.08);
	}
</style>
