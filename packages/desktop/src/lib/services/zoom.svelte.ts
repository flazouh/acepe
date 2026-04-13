/**
 * Zoom Service - Manages webview zoom level with persistence.
 *
 * Uses Tauri's webview API to control zoom and persists the level to the database.
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ResultAsync } from "neverthrow";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

/** Zoom configuration constants */
const ZOOM_CONFIG = {
	/** Default zoom level (100%) */
	DEFAULT: 1.0 as number,
	/** Minimum zoom level (50%) */
	MIN: 0.5,
	/** Maximum zoom level (200%) */
	MAX: 2.0,
	/** Zoom increment per step (10%) */
	STEP: 0.1,
};

const ZOOM_LEVEL_KEY: UserSettingKey = "zoom_level";

/**
 * Zoom Service - Singleton for managing webview zoom.
 */
export class ZoomService {
	private currentZoom = $state(ZOOM_CONFIG.DEFAULT);

	/**
	 * Gets the current zoom level.
	 */
	get zoomLevel(): number {
		return this.currentZoom;
	}

	/**
	 * Gets the current zoom level as a percentage string.
	 */
	get zoomPercentage(): string {
		return `${Math.round(this.currentZoom * 100)}%`;
	}

	/**
	 * Initializes the zoom service by loading the persisted zoom level.
	 * Should be called during app startup.
	 */
	initialize(): ResultAsync<void, Error> {
		return this.loadZoomLevel().andThen((level) => this.applyZoom(level));
	}

	/**
	 * Zooms in by one step.
	 */
	zoomIn(): ResultAsync<void, Error> {
		const newLevel = Math.min(this.currentZoom + ZOOM_CONFIG.STEP, ZOOM_CONFIG.MAX);
		return this.setZoom(newLevel);
	}

	/**
	 * Zooms out by one step.
	 */
	zoomOut(): ResultAsync<void, Error> {
		const newLevel = Math.max(this.currentZoom - ZOOM_CONFIG.STEP, ZOOM_CONFIG.MIN);
		return this.setZoom(newLevel);
	}

	/**
	 * Resets zoom to default level (100%).
	 */
	resetZoom(): ResultAsync<void, Error> {
		return this.setZoom(ZOOM_CONFIG.DEFAULT);
	}

	/**
	 * Sets the zoom to a specific level.
	 */
	setZoom(level: number): ResultAsync<void, Error> {
		const clampedLevel = Math.max(ZOOM_CONFIG.MIN, Math.min(level, ZOOM_CONFIG.MAX));
		return this.applyZoom(clampedLevel).andThen(() => this.saveZoomLevel(clampedLevel));
	}

	/**
	 * Applies the zoom level to the webview.
	 */
	private applyZoom(level: number): ResultAsync<void, Error> {
		return ResultAsync.fromPromise(
			(async () => {
				const webview = getCurrentWebview();
				await webview.setZoom(level);
				this.currentZoom = level;
			})(),
			(error) => new Error(`Failed to apply zoom: ${String(error)}`)
		);
	}

	/**
	 * Loads the zoom level from the database.
	 */
	private loadZoomLevel(): ResultAsync<number, Error> {
		return settings.getRaw(ZOOM_LEVEL_KEY).mapErr((error) => {
			return new Error(`Failed to load zoom level: ${String(error)}`);
		}).map((value) => {
			if (value === null) {
				return ZOOM_CONFIG.DEFAULT;
			}
			const parsed = parseFloat(value);
			if (Number.isNaN(parsed)) {
				return ZOOM_CONFIG.DEFAULT;
			}
			return Math.max(ZOOM_CONFIG.MIN, Math.min(parsed, ZOOM_CONFIG.MAX));
		});
	}

	/**
	 * Saves the zoom level to the database.
	 */
	private saveZoomLevel(level: number): ResultAsync<void, Error> {
		return settings.setRaw(ZOOM_LEVEL_KEY, level.toString()).mapErr((error) => {
			return new Error(`Failed to save zoom level: ${String(error)}`);
		});
	}
}

// Singleton instance
let instance: ZoomService | null = null;

/**
 * Gets the global zoom service instance.
 */
export function getZoomService(): ZoomService {
	if (!instance) {
		instance = new ZoomService();
	}
	return instance;
}

/**
 * Resets the zoom service (for testing).
 */
export function resetZoomService(): void {
	instance = null;
}
