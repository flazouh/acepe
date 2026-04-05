import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('landing hero imagery', () => {
	it('uses the dedicated landing background and foreground assets', async () => {
		const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf8');
		const demoSection = source.split('<!-- Demo Screenshot Section -->')[1] ?? '';

		expect(demoSection).toContain('/images/landing/acepe-background.webp');
		expect(demoSection).toContain('/images/landing/acepe-working-view.png');
		expect(demoSection).toContain('rounded-md');
		expect(demoSection).toContain('grayscale');
		expect(demoSection.indexOf('/images/landing/acepe-background.webp')).toBeLessThan(
			demoSection.indexOf('/images/landing/acepe-working-view.png')
		);
		expect(source).not.toContain('/images/landing/hero-demo-screenshot.png');
		expect(source).not.toContain('h-[58rem]');
	});
});