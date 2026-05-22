import type { WorkerPoolManager } from "@pierre/diffs/worker";

export interface EditToolTheme {
	theme?: "light" | "dark";
	themeNames?: { dark: string; light: string };
	workerPool?: WorkerPoolManager;
	onBeforeRender?: () => Promise<void>;
	unsafeCSS?: string;
}
