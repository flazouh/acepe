import path from "node:path";
import { fileURLToPath } from "node:url";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

import { buildAcepeUiResolveAliases } from "./scripts/vite-acepe-ui-aliases.js";

const host = process.env.TAURI_DEV_HOST;
const viteConfigDir = path.dirname(fileURLToPath(import.meta.url));
const uiPackageRoot = path.resolve(viteConfigDir, "../ui");
const uiPackageSrc = path.resolve(uiPackageRoot, "src");

/**
 * Keep @acepe/ui editable with real Svelte HMR during dev.
 *
 * `@acepe/ui` is a workspace package symlinked into node_modules. The watcher
 * below plus export-driven resolve.alias entries (see buildAcepeUiResolveAliases)
 * give every public import a single canonical module identity under
 * packages/ui/src. Without aliases, the same file can appear as both
 * `/@fs/.../packages/ui/src/...` and `/node_modules/@acepe/ui/src/...` in the
 * module graph; HMR then broadcasts duplicate updates and the WebView may keep
 * stale bindings. `resolve.preserveSymlinks: false` alone does not dedupe those
 * graph entries.
 *
 * The watcher covers packages/ui/src, which lives OUTSIDE this app's Vite root.
 * Export-driven resolve.alias entries (see buildAcepeUiResolveAliases) plus a
 * node_modules/@acepe/ui → packages/ui root alias give every import one canonical
 * module URL (typically /@fs/.../packages/ui/src/...). From there Vite's native
 * HMR pipeline + the Svelte plugin take over.
 *
 * IMPORTANT: do not manually invalidate the module graph or send `full-reload`
 * for routine content edits. Native HMR already emits in-place component updates
 * for these files. A previous version looked the file up via
 * `getModulesByFile()` and, on a miss (any module not currently in the client
 * graph — helper .ts files, unmounted components, or the window before first
 * render), blasted a `full-reload`. That, plus the manual `invalidateModule`
 * racing native HMR, is exactly what turned every UI-package edit into a full
 * page reload. Leaving content changes to Vite fixes that.
 *
 * Adding a new UI source file does NOT need a reload: a brand-new file isn't in
 * the module graph until something imports it, and the edit that adds that
 * import HMR-updates the importer, which loads the new module on demand. So we
 * let `add` flow through native HMR — this is what makes creating `@acepe/ui`
 * components (very common during UI work) hot-update instead of full-reloading.
 *
 * Deleting a file (`unlink`) is the one case we still fall back to a (rare) full
 * reload: a removed module can leave dangling references in the graph that HMR
 * can't reconcile in place.
 *
 * @returns {import("vite").Plugin}
 */
function acepeUiPackageDev() {
	return {
		name: "acepe-ui-package-dev",
		configureServer(server) {
			server.watcher.add(uiPackageSrc);

			// Vite's watcher uses ignoreInitial, so this only fires for files
			// genuinely deleted after startup — not the initial scan.
			const fullReloadOnDelete = (file) => {
				const normalizedFile = path.normalize(file);
				if (!normalizedFile.startsWith(uiPackageSrc)) {
					return;
				}
				server.ws.send({ type: "full-reload" });
			};

			server.watcher.on("unlink", fullReloadOnDelete);
		},
	};
}

/**
 * Reload the Electrobun window on a code edit instead of trusting in-place HMR.
 *
 * Measured in the real WebView (scripts/dev-app.sh loop): the HMR update reaches
 * the page and an accept callback registered on the component path does fire, but
 * Svelte's own swap leaves the rendered tree on the old version. A `label` change
 * in top-bar.svelte never appeared, while `/src/app.css` hot-updated every time.
 * A window that shows stale UI is worse than a reload, because QA then reads a DOM
 * that does not match the code under test.
 *
 * So: CSS keeps native HMR, and any other edit reloads the document, which costs
 * about 7 seconds and no rebuild. This is gated on the dev-app loop, so a browser
 * client on port 1420 keeps the native HMR behaviour described above.
 *
 * @returns {import("vite").Plugin}
 */
function acepeElectrobunDevReload() {
	const electrobunDevLoop = process.env.ACEPE_ELECTROBUN_DEV === "1";
	const sourceRoots = [path.resolve(viteConfigDir, "src"), uiPackageSrc];
	const reloadable = /\.(svelte|ts|js)$/;
	let lastReloadAt = 0;

	return {
		name: "acepe-electrobun-dev-reload",
		apply: "serve",
		handleHotUpdate({ file, server }) {
			if (electrobunDevLoop === false) {
				return undefined;
			}
			const normalizedFile = path.normalize(file);
			const isSource = sourceRoots.some((root) => normalizedFile.startsWith(root));
			if (isSource === false || reloadable.test(normalizedFile) === false) {
				return undefined;
			}
			// One save touches several modules, and every reload re-requests the
			// whole dev module graph, so collapse a burst into a single reload.
			// Back-to-back reloads also killed the WebView while a QA script was
			// reading the DOM, so keep the window wide enough to cover a save burst.
			const now = Date.now();
			if (now - lastReloadAt < 1200) {
				return [];
			}
			lastReloadAt = now;
			// server.hot replaced server.ws in Vite 6; keep both so a version bump
			// cannot silently turn this into a no-op.
			const channel = server.hot ?? server.ws;
			channel.send({ type: "full-reload" });
			server.config.logger.info(`[acepe] full reload for ${normalizedFile}`);
			return [];
		},
	};
}

const ignoredDevWatchPaths = [
	"**/src-tauri/**",
	// The built Electrobun app lives here. Watching it made every build artifact
	// look like a source change.
	"**/electrobun-build/**",
	"**/electrobun-artifacts/**",
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
		chunkSizeWarningLimit: 1500,
	},
	worker: {
		format: "es",
	},
	plugins: [acepeUiPackageDev(), acepeElectrobunDevReload(), sveltekit(), tailwindcss()],

	resolve: {
		// Canonical @acepe/ui module identity for watcher + HMR alignment.
		preserveSymlinks: false,
		dedupe: ["@acepe/ui"],
		alias: buildAcepeUiResolveAliases(uiPackageRoot, {
			desktopPackageRoot: viteConfigDir,
		}),
	},

	// Keep workspace UI source out of the dep pre-bundle cache.
	optimizeDeps: {
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
