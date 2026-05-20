import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			runed: fileURLToPath(new URL("./node_modules/runed/dist/index.js", import.meta.url)),
		},
	},

	test: {
		expect: { requireAssertions: true },
		environment: "node",
		include: ["src/**/*.{test,spec}.{js,ts}"],
		exclude: ["**/node_modules/**", "src/**/*.svelte.{test,spec}.{js,ts}"],
	},
});
