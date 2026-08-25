import { fromPromise } from "@acepe/effect-result/fromPromise";
import type * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { AgentError } from "../../acp/errors/app-error.js";

interface NativeNotificationOptions {
	readonly title: string;
	readonly body: string;
}

type NativeNotificationPermissionState =
	| "default"
	| "denied"
	| "granted"
	| "prompt"
	| "prompt-with-rationale";

const toAgentError =
	(operation: string) =>
	(error: unknown): AgentError =>
		new AgentError(operation, error instanceof Error ? error : new Error(String(error)));

export const notifications = {
	send: (options: NativeNotificationOptions): Effect.Effect<void, AppError> => {
		return fromPromise(async () => {
			if (typeof Notification === "undefined") {
				throw new Error("Web notifications are not available");
			}
			new Notification(options.title, { body: options.body });
		}, toAgentError("notifications.send"));
	},

	getPermission: (): Effect.Effect<boolean | null, AppError> => {
		return fromPromise(async () => {
			if (typeof Notification === "undefined") {
				return null;
			}
			return Notification.permission === "granted";
		}, toAgentError("notifications.getPermission"));
	},

	requestPermission: (): Effect.Effect<NativeNotificationPermissionState, AppError> => {
		return fromPromise(async () => {
			if (typeof Notification === "undefined") {
				return "denied" as const;
			}
			const permission = await Notification.requestPermission();
			if (permission === "granted" || permission === "denied" || permission === "default") {
				return permission;
			}
			return "default";
		}, toAgentError("notifications.requestPermission"));
	},
};
