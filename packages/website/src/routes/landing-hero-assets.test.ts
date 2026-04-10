import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('landing hero imagery', () => {
	it('uses the shared kanban landing demo inside the shader container', async () => {
		const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf8');
		const demoSection =
			source.split('<!-- Demo Screenshot Section -->')[1]?.split('<!-- What is an ADE? -->')[0] ?? '';

		expect(source).toContain('LandingKanbanDemo');
		expect(demoSection).toContain('<BrandShaderBackground class="rounded-xl" fallback="gradient" />');
		expect(demoSection).toContain('<LandingKanbanDemo />');
		expect(demoSection).toContain('rounded-md');
		expect(demoSection).toContain('shadow-[0_24px_80px_rgba(0,0,0,0.42)]');
		expect(demoSection).not.toContain('/images/landing/acepe-working-view.png');
		expect(source).not.toContain('<TextShimmer>{m.landing_hero_cta()}</TextShimmer>');
		expect(source).not.toContain('/images/landing/hero-demo-screenshot.png');
		expect(source).not.toContain('h-[58rem]');
	});
});
