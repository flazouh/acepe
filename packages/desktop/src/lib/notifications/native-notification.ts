import type { ResultAsync } from "neverthrow";
import type { AppError } from "$lib/acp/errors/app-error.js";
import { notifications } from "$lib/utils/tauri-client/notifications.js";

export interface NativeNotificationPayload {
	readonly title: string;
	readonly body: string;
}

export async function getNotificationPermission(): Promise<boolean> {
	return notifications.getPermission().match(
		(permissionGranted) => permissionGranted ?? false,
		(error) => {
			throw error;
		}
	);
}

export async function requestNotificationPermission(): Promise<"default" | "denied" | "granted"> {
	return notifications.requestPermission().match(
		(permission) => {
			if (permission === "prompt" || permission === "prompt-with-rationale") {
				return "default";
			}
			return permission;
		},
		(error) => {
			throw error;
		}
	);
}

export function sendNativeNotification(
	payload: NativeNotificationPayload
): ResultAsync<void, AppError> {
	return notifications.send(payload);
}
