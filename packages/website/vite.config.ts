import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/lib/paraglide",
		}) as PluginOption,
	],

	test: {
		expect: { requireAssertions: true },
		environment: "node",
		include: ["src/**/*.{test,spec}.{js,ts}"],
		exclude: ["**/node_modules/**", "src/**/*.svelte.{test,spec}.{js,ts}"],
	},
});
