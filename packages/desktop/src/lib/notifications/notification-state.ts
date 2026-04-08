/**
 * Notification state - Pure module-level state (no Svelte runes).
 *
 * All mutation logic lives here so it can be tested with bun test.
 * The .svelte.ts wrapper subscribes to changes and mirrors into $state.
 */

import { okAsync, Result, ResultAsync } from "neverthrow";
import { SoundEffect } from "$lib/acp/types/sounds.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { playSound } from "$lib/acp/utils/sound.js";
import {
	getNotificationPermission,
	requestNotificationPermission,
	sendNativeNotification,
} from "./native-notification.js";

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

interface NotificationRuntime {
	readonly isMacOs: () => boolean;
	readonly getPermission: () => Promise<boolean>;
	readonly requestPermission: () => Promise<NativeNotificationPermissionState>;
	readonly send: (payload: { title: string; body: string }) => void;
}

type NativeNotificationPermission = "unknown" | "granted" | "denied";
type NativeNotificationPermissionState = "default" | "denied" | "granted";

let notifications: ActiveNotification[] = [];
let lastSoundTime = 0;
let nativeNotificationPermission: NativeNotificationPermission = "unknown";

const defaultNotificationRuntime: NotificationRuntime = {
	isMacOs: () => {
		if (typeof navigator === "undefined") return false;
		return navigator.platform.includes("Mac");
	},
	getPermission: () => getNotificationPermission(),
	requestPermission: () => requestNotificationPermission(),
	send: (payload) => {
		sendNativeNotification(payload);
	},
};

let notificationRuntime: NotificationRuntime = defaultNotificationRuntime;

const SOUND_DEBOUNCE_MS = 2000;
const MAX_NOTIFICATIONS = 6;

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
	const useNativeNotification = notificationRuntime.isMacOs();
	if (!useNativeNotification && notifications.some((n) => n.id === payload.id)) return;

	if (useNativeNotification) {
		maybeSendNativeNotification(payload);
		maybePlaySound();
		return;
	}

	notifications = [...notifications, { id: payload.id, payload, onAction }];

	// Evict oldest notifications when cap exceeded
	if (notifications.length > MAX_NOTIFICATIONS) {
		notifications = notifications.slice(-MAX_NOTIFICATIONS);
	}

	maybePlaySound();
}

/**
 * Dismiss a single notification. Idempotent.
 */
export function dismissNotification(id: string): void {
	notifications = notifications.filter((n) => n.id !== id);
}

/**
 * Dismiss all notifications.
 */
export function dismissAll(): void {
	if (notifications.length === 0) return;
	notifications = [];
}

/**
 * Dismiss notifications matching a predicate.
 */
export function dismissWhere(predicate: (notif: ActiveNotification) => boolean): void {
	notifications = notifications.filter((n) => !predicate(n));
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

export function setNotificationRuntimeForTesting(runtime: NotificationRuntime): void {
	notificationRuntime = runtime;
	nativeNotificationPermission = "unknown";
	lastSoundTime = 0;
}

export function resetNotificationRuntimeForTesting(): void {
	notificationRuntime = defaultNotificationRuntime;
	nativeNotificationPermission = "unknown";
	lastSoundTime = 0;
}

// ── Internal ───────────────────────────────────────────────────────────

function maybeSendNativeNotification(payload: NotificationPayload): void {
	ensureNativeNotificationPermission()
		.andThen((permissionGranted) => {
			if (!permissionGranted) return okAsync(undefined);

			return ResultAsync.fromPromise(
				Promise.resolve().then(() => {
					notificationRuntime.send({
						title: payload.title,
						body: payload.body,
					});
				}),
				(error) => new Error(`Failed to send native notification: ${error}`)
			);
		})
		.match(
			() => {},
			(error) => {
				logger.error("Failed to send native notification", {
					notificationId: payload.id,
					error,
				});
			}
		);
}

function ensureNativeNotificationPermission(): ResultAsync<boolean, Error> {
	if (nativeNotificationPermission === "granted") return okAsync(true);
	if (nativeNotificationPermission === "denied") return okAsync(false);

	return ResultAsync.fromPromise(
		notificationRuntime.getPermission(),
		(error) => new Error(`Failed to read native notification permission: ${error}`)
	).andThen((alreadyGranted) => {
		if (alreadyGranted) {
			nativeNotificationPermission = "granted";
			return okAsync(true);
		}

		return ResultAsync.fromPromise(
			notificationRuntime.requestPermission(),
			(error) => new Error(`Failed to request native notification permission: ${error}`)
		).map((permission) => {
			const granted = permission === "granted";
			nativeNotificationPermission = granted ? "granted" : "denied";
			return granted;
		});
	});
}

function maybePlaySound(): void {
	const now = Date.now();
	if (now - lastSoundTime > SOUND_DEBOUNCE_MS) {
		playSound(SoundEffect.Achievement);
		lastSoundTime = now;
	}
}
