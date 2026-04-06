import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('ParallelSessionsShowcase', () => {
	it('uses shared UI building blocks instead of fake session skeletons', async () => {
		const source = await readFile(
			new URL('./parallel-sessions-showcase.svelte', import.meta.url),
			'utf8'
		);

		expect(source).toContain('<AppTabBar');
		expect(source).toContain('<ProjectCard');
		expect(source.match(/<AgentPanelLayout/gm)).toHaveLength(2);
		expect(source).not.toContain('SESSION 1');
		expect(source).not.toContain('SESSION 2');
		expect(source).not.toContain('h-1.5 w-full rounded-full');
	});
});
