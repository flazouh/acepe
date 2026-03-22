import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("$lib/acp/types/sounds.js", () => ({
	SoundEffect: { LeonardoDiCaprio: "leonardo-di-caprio" },
}));

mock.module("$lib/acp/utils/sound.js", () => ({
	playSound: mock(() => {}),
}));

mock.module("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	}),
}));

// Import from the plain .ts module (no Svelte runes needed)
import type { NotificationPayload } from "./notification-state.js";
import {
	dismissAll,
	dismissNotification,
	dismissWhere,
	getActiveCount,
	handleNotificationAction,
	PERMISSION_ACTIONS,
	QUESTION_ACTIONS,
	showNotification,
} from "./notification-state.js";

describe("notification-service", () => {
	afterEach(() => {
		dismissAll();
	});

	it("adds notification to state", () => {
		const payload: NotificationPayload = {
			id: "perm-1",
			type: "permission",
			title: "Permission request",
			body: "Allow tool use",
			actions: PERMISSION_ACTIONS,
		};

		showNotification(payload, () => {}, {
			windowFocused: false,
			categoryEnabled: true,
		});

		expect(getActiveCount()).toBe(1);
	});

	it("skips notification when window is focused", () => {
		const payload: NotificationPayload = {
			id: "perm-2",
			type: "permission",
			title: "Test",
			body: "Test",
			actions: PERMISSION_ACTIONS,
		};

		showNotification(payload, () => {}, {
			windowFocused: true,
			categoryEnabled: true,
		});

		expect(getActiveCount()).toBe(0);
	});

	it("skips notification when category is disabled", () => {
		const payload: NotificationPayload = {
			id: "perm-3",
			type: "permission",
			title: "Test",
			body: "Test",
			actions: PERMISSION_ACTIONS,
		};

		showNotification(payload, () => {}, {
			windowFocused: false,
			categoryEnabled: false,
		});

		expect(getActiveCount()).toBe(0);
	});

	it("deduplicates by ID", () => {
		const payload: NotificationPayload = {
			id: "perm-4",
			type: "permission",
			title: "Test",
			body: "Test",
			actions: PERMISSION_ACTIONS,
		};

		showNotification(payload, () => {}, {
			windowFocused: false,
			categoryEnabled: true,
		});
		showNotification(payload, () => {}, {
			windowFocused: false,
			categoryEnabled: true,
		});

		expect(getActiveCount()).toBe(1);
	});

	it("dismissNotification removes by ID", () => {
		const payload: NotificationPayload = {
			id: "perm-5",
			type: "permission",
			title: "Test",
			body: "Test",
			actions: PERMISSION_ACTIONS,
		};

		showNotification(payload, () => {}, {
			windowFocused: false,
			categoryEnabled: true,
		});

		expect(getActiveCount()).toBe(1);
		dismissNotification("perm-5");
		expect(getActiveCount()).toBe(0);
	});

	it("dismissAll clears all notifications", () => {
		showNotification(
			{
				id: "a",
				type: "permission",
				title: "A",
				body: "A",
				actions: PERMISSION_ACTIONS,
			},
			() => {},
			{ windowFocused: false, categoryEnabled: true }
		);
		showNotification(
			{
				id: "b",
				type: "question",
				title: "B",
				body: "B",
				actions: QUESTION_ACTIONS,
			},
			() => {},
			{ windowFocused: false, categoryEnabled: true }
		);

		expect(getActiveCount()).toBe(2);
		dismissAll();
		expect(getActiveCount()).toBe(0);
	});

	it("dismissWhere selectively removes matching notifications", () => {
		showNotification(
			{
				id: "keep",
				type: "permission",
				title: "Keep",
				body: "Keep",
				actions: PERMISSION_ACTIONS,
			},
			() => {},
			{ windowFocused: false, categoryEnabled: true }
		);
		showNotification(
			{
				id: "remove",
				type: "question",
				title: "Remove",
				body: "Remove",
				actions: QUESTION_ACTIONS,
			},
			() => {},
			{ windowFocused: false, categoryEnabled: true }
		);

		dismissWhere((notif) => notif.id === "remove");
		expect(getActiveCount()).toBe(1);
	});

	it("handleNotificationAction invokes callback without dismissing", () => {
		const onAction = mock(() => {});

		showNotification(
			{
				id: "action-1",
				type: "permission",
				title: "Test",
				body: "Test",
				actions: PERMISSION_ACTIONS,
			},
			onAction,
			{ windowFocused: false, categoryEnabled: true }
		);

		handleNotificationAction("action-1", "allow");
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(onAction).toHaveBeenCalledWith("allow");
		// Card handles its own dismissal after exit animation
		expect(getActiveCount()).toBe(1);
	});

	it("does not throw when action callback throws", () => {
		showNotification(
			{
				id: "action-2",
				type: "permission",
				title: "Test",
				body: "Test",
				actions: PERMISSION_ACTIONS,
			},
			() => {
				throw new Error("callback failed");
			},
			{ windowFocused: false, categoryEnabled: true }
		);

		expect(() => {
			handleNotificationAction("action-2", "allow");
		}).not.toThrow();
		// Card handles its own dismissal after exit animation
		expect(getActiveCount()).toBe(1);
	});

	it("caps notifications at MAX_NOTIFICATIONS", () => {
		for (let i = 0; i < 10; i++) {
			showNotification(
				{
					id: `cap-${i}`,
					type: "permission",
					title: "Test",
					body: "Test",
					actions: PERMISSION_ACTIONS,
				},
				() => {},
				{ windowFocused: false, categoryEnabled: true }
			);
		}

		expect(getActiveCount()).toBe(6);
	});
});
