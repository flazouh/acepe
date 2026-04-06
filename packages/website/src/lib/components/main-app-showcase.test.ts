import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

describe('MainAppShowcase', () => {
	it('renders a stable desktop-faithful shell as a single reusable component', async () => {
		const { default: MainAppShowcase } = await import('./main-app-showcase.svelte');
		const { body } = render(MainAppShowcase);

		expect(body).toContain('Migrate auth to JWT');
		expect(body).toContain('Fix N+1 queries');
		expect(body).toContain('TypeScript strict mode');
		expect(body).toContain('Setup CI pipeline');
		expect(body).toContain('Working');
		expect(body).toContain('Needs Review');
		expect(body).not.toContain('↺ Replay');
	});
});
