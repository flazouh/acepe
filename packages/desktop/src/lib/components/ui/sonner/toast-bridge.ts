type ToastKind = "success" | "error" | "info" | "warning";

type ToastBridge = Record<ToastKind, (message: string) => void>;

let activeToastBridge: ToastBridge | null = null;

export function registerToastBridge(bridge: ToastBridge): void {
	activeToastBridge = bridge;
}

function showToast(kind: ToastKind, message: string): void {
	activeToastBridge?.[kind](message);
}

export function toastSuccess(message: string): void {
	showToast("success", message);
}

export function toastError(message: string): void {
	showToast("error", message);
}

export function toastInfo(message: string): void {
	showToast("info", message);
}

export function toastWarning(message: string): void {
	showToast("warning", message);
}
