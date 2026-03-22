import { describe, expect, it } from 'vitest';

import { getInitialTheme, getToggledTheme } from './theme';

describe('theme helpers', () => {
	it('defaults to dark when no stored preference exists', () => {
		expect(getInitialTheme(null)).toBe('dark');
	});

	it('uses a valid stored light preference', () => {
		expect(getInitialTheme('light')).toBe('light');
	});

	it('falls back to dark for an invalid stored preference', () => {
		expect(getInitialTheme('system')).toBe('dark');
	});

	it('toggles between dark and light', () => {
		expect(getToggledTheme('dark')).toBe('light');
		expect(getToggledTheme('light')).toBe('dark');
	});
});
