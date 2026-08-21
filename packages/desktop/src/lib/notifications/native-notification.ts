import * as Effect from "effect/Effect";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { notifications } from "$lib/utils/tauri-client/notifications.js";

export interface NativeNotificationPayload {
	readonly title: string;
	readonly body: string;
}

export async function getNotificationPermission(): Promise<boolean> {
	const permissionGranted = await Effect.runPromise(notifications.getPermission());
	return permissionGranted ?? false;
}

export async function requestNotificationPermission(): Promise<"default" | "denied" | "granted"> {
	const permission = await Effect.runPromise(notifications.requestPermission());
	if (permission === "prompt" || permission === "prompt-with-rationale") {
		return "default";
	}
	return permission;
}

export function sendNativeNotification(
	payload: NativeNotificationPayload
): Effect.Effect<void, AppError> {
	return notifications.send(payload);
}
