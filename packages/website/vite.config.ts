import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],

	test: {
		expect: { requireAssertions: true },
		environment: "node",
		include: ["src/**/*.{test,spec}.{js,ts}"],
		exclude: ["**/node_modules/**", "src/**/*.svelte.{test,spec}.{js,ts}"],
	},
});
