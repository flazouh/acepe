/**
 * Notification Service - Reactive wrapper for Svelte 5.
 *
 * Re-exports all public API from notification-state.ts and adds
 * a reactive store using $state for Svelte component consumption.
 *
 * The plain state module (notification-state.ts) holds the actual logic
 * and is directly testable with bun test. This .svelte.ts wrapper mirrors
 * the state into $state for Svelte reactivity.
 */

export {
	COMPLETION_ACTIONS,
	dismissAll,
	dismissNotification,
	dismissWhere,
	getActiveCount,
	getNotifications,
	handleNotificationAction,
	PERMISSION_ACTIONS,
	QUESTION_ACTIONS,
	showNotification,
} from "./notification-state.js";

export type {
	ActiveNotification,
	NotificationPayload,
	PopupAction,
	PopupActionId,
} from "./notification-state.js";

import type { ActiveNotification } from "./notification-state.js";
import { getNotifications, onNotificationsChanged } from "./notification-state.js";

// Mirror of notification-state into $state for Svelte 5 reactivity.
let reactiveNotifications = $state<readonly ActiveNotification[]>([]);

// Subscribe to changes from the plain state module
onNotificationsChanged(() => {
	reactiveNotifications = getNotifications();
});

/**
 * Reactive store for Svelte components. Uses getter properties
 * so Svelte 5's fine-grained reactivity tracks reads.
 */
export function getNotificationStore() {
	return {
		get notifications() {
			return reactiveNotifications;
		},
		get hasNotifications() {
			return reactiveNotifications.length > 0;
		},
	};
}
