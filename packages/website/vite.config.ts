import { defineConfig } from 'vitest/config';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }) as any
	],

	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: [
			'**/node_modules/**',
			'src/**/*.svelte.{test,spec}.{js,ts}'
		]
	}
});
