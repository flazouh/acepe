import { listen as defaultTauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { createLogger } from "../../../utils/logger.js";

export type DragDropPosition = {
	readonly x: number;
	readonly y: number;
};

export type DragDropPayload = {
	readonly paths: readonly string[];
	readonly position: DragDropPosition;
};

export type TauriDragDropEvent = {
	readonly payload: DragDropPayload;
};

/** Minimal listen seam for production Tauri + deterministic test fakes. */
export type TauriDragDropListen = <T>(
	event: string,
	handler: (event: { payload: T }) => void
) => Promise<UnlistenFn>;

export type TauriDragDropControllerCallbacks = {
	readonly onDragOver: (position: DragDropPosition) => void;
	readonly onDrop: (paths: readonly string[], position: DragDropPosition) => void | Promise<void>;
	readonly onDragLeave: () => void;
};

export type TauriDragDropControllerDeps = {
	readonly listen?: TauriDragDropListen;
	readonly callbacks: TauriDragDropControllerCallbacks;
};

type DragDropListenerKind = "hover" | "drop" | "leave";

/**
 * Owns Tauri drag-drop listener registration/teardown with an isDestroyed guard
 * so late-arriving unlisten handles are invoked instead of leaked.
 */
export class TauriDragDropController {
	readonly #listen: TauriDragDropListen;
	readonly #callbacks: TauriDragDropControllerCallbacks;
	readonly #logger = createLogger({
		id: "tauri-drag-drop-controller",
		name: "TauriDragDropController",
	});

	#unlistenHover: UnlistenFn | null = null;
	#unlistenDrop: UnlistenFn | null = null;
	#unlistenLeave: UnlistenFn | null = null;
	#isDestroyed = false;

	constructor(deps: TauriDragDropControllerDeps) {
		this.#listen = deps.listen ?? defaultTauriListen;
		this.#callbacks = deps.callbacks;
	}

	start(): void {
		this.#isDestroyed = false;
		void this.#setupListeners();
	}

	destroy(): void {
		this.#isDestroyed = true;
		this.#clearListener("hover");
		this.#clearListener("drop");
		this.#clearListener("leave");
	}

	async #setupListeners(): Promise<void> {
		const hoverUnlisten = await this.#listen<DragDropPayload>("tauri://drag-over", (event) => {
			if (this.#isDestroyed) {
				return;
			}
			this.#callbacks.onDragOver(event.payload.position);
		});
		this.#registerResolvedListener("hover", hoverUnlisten);

		const dropUnlisten = await this.#listen<DragDropPayload>("tauri://drag-drop", (event) => {
			if (this.#isDestroyed) {
				return;
			}
			void this.#callbacks.onDrop(event.payload.paths, event.payload.position);
		});
		this.#registerResolvedListener("drop", dropUnlisten);

		const leaveUnlisten = await this.#listen<DragDropPayload>("tauri://drag-leave", () => {
			if (this.#isDestroyed) {
				return;
			}
			this.#callbacks.onDragLeave();
		});
		this.#registerResolvedListener("leave", leaveUnlisten);
	}

	#registerResolvedListener(listenerKind: DragDropListenerKind, unlisten: UnlistenFn): void {
		const managedUnlisten = this.#createManagedUnlisten(unlisten);

		if (this.#isDestroyed) {
			this.#runUnlisten(listenerKind, managedUnlisten);
			return;
		}

		if (listenerKind === "hover") {
			this.#unlistenHover = managedUnlisten;
			return;
		}

		if (listenerKind === "drop") {
			this.#unlistenDrop = managedUnlisten;
			return;
		}

		this.#unlistenLeave = managedUnlisten;
	}

	#createManagedUnlisten(unlisten: UnlistenFn): UnlistenFn {
		let isActive = true;

		return async () => {
			if (!isActive) {
				return;
			}
			isActive = false;
			await unlisten();
		};
	}

	#clearListener(listenerKind: DragDropListenerKind): void {
		if (listenerKind === "hover") {
			const unlisten = this.#unlistenHover;
			this.#unlistenHover = null;
			if (unlisten !== null) {
				this.#runUnlisten(listenerKind, unlisten);
			}
			return;
		}

		if (listenerKind === "drop") {
			const unlisten = this.#unlistenDrop;
			this.#unlistenDrop = null;
			if (unlisten !== null) {
				this.#runUnlisten(listenerKind, unlisten);
			}
			return;
		}

		const unlisten = this.#unlistenLeave;
		this.#unlistenLeave = null;
		if (unlisten !== null) {
			this.#runUnlisten(listenerKind, unlisten);
		}
	}

	#runUnlisten(listenerKind: DragDropListenerKind, unlisten: UnlistenFn): void {
		void Promise.resolve()
			.then(() => unlisten())
			.catch((rawError) => {
				const error = rawError instanceof Error ? rawError : new Error(String(rawError));
				if (error.message.includes("listeners[eventId].handlerId")) {
					this.#logger.debug("Drag-drop listener already removed during teardown", {
						listenerKind,
						error,
					});
					return;
				}
				this.#logger.warn("Failed to unregister drag-drop listener", {
					listenerKind,
					error,
				});
			});
	}
}
