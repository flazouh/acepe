import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('homepage hero demo composition', () => {
	it('uses the extracted main app showcase instead of inline image markup', async () => {
		const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf8');
		const demoSection = source.split('<!-- Demo Screenshot Section -->')[1] ?? '';

		expect(source).toContain(
			'import MainAppShowcase from "$lib/components/showcases/main-app-showcase.svelte";'
		);
		expect(demoSection).toContain('<MainAppShowcase />');
		expect(demoSection).not.toContain('/images/landing/acepe-background.webp');
		expect(demoSection).not.toContain('/images/landing/acepe-working-view.png');
	});
});
