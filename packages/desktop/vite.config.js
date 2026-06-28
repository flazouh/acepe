import path from "node:path";
import { fileURLToPath } from "node:url";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
const viteConfigDir = path.dirname(fileURLToPath(import.meta.url));
const uiPackageRoot = path.resolve(viteConfigDir, "../ui");
const uiPackageSrc = path.resolve(uiPackageRoot, "src");

/**
 * Keep @acepe/ui editable with real Svelte HMR during dev.
 *
 * `@acepe/ui` is a workspace package symlinked into node_modules, but with
 * `resolve.preserveSymlinks: false` (below) its modules resolve to their real
 * source under packages/ui/src — which lives OUTSIDE this app's Vite root, so
 * Vite doesn't watch it by default. We add that directory to the watcher; from
 * there Vite's native HMR pipeline + the Svelte plugin take over.
 *
 * IMPORTANT: do not manually invalidate the module graph or send `full-reload`
 * for routine content edits. Because preserveSymlinks keeps module-graph paths
 * aligned with the watcher, native HMR already emits in-place component updates
 * for these files. A previous version looked the file up via
 * `getModulesByFile()` and, on a miss (any module not currently in the client
 * graph — helper .ts files, unmounted components, or the window before first
 * render), blasted a `full-reload`. That, plus the manual `invalidateModule`
 * racing native HMR, is exactly what turned every UI-package edit into a full
 * page reload. Leaving content changes to Vite fixes that.
 *
 * Only structural changes — a UI source file being added or removed, which can
 * shift the package's export surface and isn't a safe in-place HMR boundary —
 * fall back to a (rare) full reload.
 *
 * @returns {import("vite").Plugin}
 */
function acepeUiPackageDev() {
	return {
		name: "acepe-ui-package-dev",
		configureServer(server) {
			server.watcher.add(uiPackageSrc);

			// Vite's watcher uses ignoreInitial, so these only fire for files
			// genuinely created/deleted after startup — not the initial scan.
			const fullReloadOnStructuralChange = (file) => {
				const normalizedFile = path.normalize(file);
				if (!normalizedFile.startsWith(uiPackageSrc)) {
					return;
				}
				server.ws.send({ type: "full-reload" });
			};

			server.watcher.on("add", fullReloadOnStructuralChange);
			server.watcher.on("unlink", fullReloadOnStructuralChange);
		},
	};
}

const ignoredDevWatchPaths = [
	"**/src-tauri/**",
	"**/__tests__/**",
	"**/*.test.{js,ts}",
	"**/*.spec.{js,ts}",
	"**/*.vitest.{js,ts}",
	"**/.svelte-kit/**",
	"**/build/**",
	"**/dist/**",
	"**/coverage/**",
];

// https://vite.dev/config/
export default defineConfig({
	build: {
		sourcemap: "hidden",
	},
	worker: {
		format: "es",
	},
	plugins: [acepeUiPackageDev(), sveltekit(), tailwindcss()],

	resolve: {
		// Resolve @acepe/ui through real paths so file watchers and HMR line up.
		preserveSymlinks: false,
		dedupe: ["@acepe/ui"],
	},

	// Keep workspace UI source out of the dep pre-bundle cache.
	optimizeDeps: {
		include: ["@tabler/icons-svelte", "phosphor-svelte"],
		exclude: ["@acepe/ui"],
	},

	ssr: {
		noExternal: ["@acepe/ui"],
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. ignore backend sources, generated outputs, and test-only files that should never reload the app UI
			ignored: ignoredDevWatchPaths,
		},
		fs: {
			allow: [uiPackageRoot, uiPackageSrc],
		},
	},

	// Vitest configuration for testing Svelte 5 runes
	test: {
		globals: true,
		environment: "happy-dom",
		// Only include .svelte.test.ts and .vitest.ts files (rune tests) - exclude regular Bun tests
		include: ["**/*.svelte.{test,spec}.{js,ts}", "**/*.vitest.{js,ts}"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.{idea,git,cache,output,temp}/**",
			"**/src-tauri/**",
		],
		// Tell Vitest to use browser entry points when running tests
		// @ts-expect-error
		resolve: process.env.VITEST
			? {
					conditions: ["browser"],
				}
			: undefined,
	},
});
