/**
 * Notification state - Pure module-level state (no Svelte runes).
 *
 * All mutation logic lives here so it can be tested with bun test.
 * The .svelte.ts wrapper subscribes to changes and mirrors into $state.
 */

import { Result } from "neverthrow";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { playSound } from "$lib/acp/utils/sound.js";

// ── Types ──────────────────────────────────────────────────────────────

export type PopupActionId = "allow" | "allow-always" | "deny" | "view" | "dismiss";

export interface PopupAction {
	id: PopupActionId;
	label: string;
	variant: "primary" | "secondary" | "ghost";
}

export interface NotificationPayload {
	id: string;
	type: "permission" | "question" | "completion";
	title: string;
	body: string;
	actions: PopupAction[];
	autoDismissMs?: number;
	/** Session that triggered this notification (for agent-native correlation). */
	sessionId?: string;
	/** Underlying permission/question ID (for agent-native correlation). */
	sourceId?: string;
}

// ── Action Templates ───────────────────────────────────────────────────

export const PERMISSION_ACTIONS: PopupAction[] = [
	{ id: "allow", label: "Allow", variant: "primary" },
	{ id: "allow-always", label: "Always Allow", variant: "secondary" },
	{ id: "deny", label: "Deny", variant: "ghost" },
];

export const QUESTION_ACTIONS: PopupAction[] = [{ id: "view", label: "View", variant: "primary" }];

export const COMPLETION_ACTIONS: PopupAction[] = [{ id: "view", label: "View", variant: "ghost" }];

// ── Module State ───────────────────────────────────────────────────────

const logger = createLogger({ id: "notification-service", name: "NotificationService" });

export interface ActiveNotification {
	id: string;
	payload: NotificationPayload;
	onAction: (actionId: PopupActionId) => void;
}

let notifications: ActiveNotification[] = [];
let lastSoundTime = 0;
let onChange: (() => void) | null = null;

const SOUND_DEBOUNCE_MS = 2000;
const MAX_NOTIFICATIONS = 6;

// ── Change Subscription ────────────────────────────────────────────────

/**
 * Register a callback that fires after any state mutation.
 * Only one subscriber is supported (the .svelte.ts reactive wrapper).
 */
export function onNotificationsChanged(callback: () => void): void {
	if (onChange !== null) {
		throw new Error("onNotificationsChanged already has a subscriber");
	}
	onChange = callback;
}

function notifyChange(): void {
	onChange?.();
}

// ── Public API ─────────────────────────────────────────────────────────

/** Read-only snapshot of current notifications. */
export function getNotifications(): readonly ActiveNotification[] {
	return notifications;
}

/**
 * Show a notification popup.
 */
export function showNotification(
	payload: NotificationPayload,
	onAction: (actionId: PopupActionId) => void,
	opts: { windowFocused: boolean; categoryEnabled: boolean }
): void {
	if (opts.windowFocused) return;
	if (!opts.categoryEnabled) return;
	if (notifications.some((n) => n.id === payload.id)) return;

	notifications = [...notifications, { id: payload.id, payload, onAction }];

	// Evict oldest notifications when cap exceeded
	if (notifications.length > MAX_NOTIFICATIONS) {
		notifications = notifications.slice(-MAX_NOTIFICATIONS);
	}

	maybePlaySound();
	notifyChange();
}

/**
 * Dismiss a single notification. Idempotent.
 */
export function dismissNotification(id: string): void {
	const prev = notifications.length;
	notifications = notifications.filter((n) => n.id !== id);
	if (notifications.length !== prev) notifyChange();
}

/**
 * Dismiss all notifications.
 */
export function dismissAll(): void {
	if (notifications.length === 0) return;
	notifications = [];
	notifyChange();
}

/**
 * Dismiss notifications matching a predicate.
 */
export function dismissWhere(predicate: (notif: ActiveNotification) => boolean): void {
	const prev = notifications.length;
	notifications = notifications.filter((n) => !predicate(n));
	if (notifications.length !== prev) notifyChange();
}

/**
 * Handle an action from a notification card. Fires callback immediately.
 * Dismissal is handled by the card after its exit animation completes.
 */
export function handleNotificationAction(id: string, actionId: PopupActionId): void {
	const notif = notifications.find((n) => n.id === id);
	if (!notif) return;

	Result.fromThrowable(
		() => {
			notif.onAction(actionId);
		},
		() => new Error("notification action callback failed")
	)().match(
		() => {},
		(error) => {
			logger.error("Notification action callback failed", {
				notificationId: id,
				actionId,
				error,
			});
		}
	);
}

/**
 * Get count of active notifications (for testing/debugging).
 */
export function getActiveCount(): number {
	return notifications.length;
}

// ── Internal ───────────────────────────────────────────────────────────

function maybePlaySound(): void {
	const now = Date.now();
	if (now - lastSoundTime > SOUND_DEBOUNCE_MS) {
		playSound(SoundEffect.LeonardoDiCaprio);
		lastSoundTime = now;
	}
}
