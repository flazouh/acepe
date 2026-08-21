import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";
import { invokeAsync, invokeAsyncQuiet } from "./invoke.js";

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

export const notifications = {
	send: (options: NativeNotificationOptions): Effect.Effect<void, AppError> => {
		return invokeAsyncQuiet<void>(CMD.notifications.send, { options });
	},

	getPermission: (): Effect.Effect<boolean | null, AppError> => {
		return invokeAsync<boolean | null>(CMD.notifications.get_permission);
	},

	requestPermission: (): Effect.Effect<NativeNotificationPermissionState, AppError> => {
		return invokeAsync<NativeNotificationPermissionState>(CMD.notifications.request_permission);
	},
};
