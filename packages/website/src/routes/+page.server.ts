import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { container } from '$lib/server/infrastructure/container';
import { getLocale } from '$lib/paraglide/runtime';

export const actions = {
	join: async ({ request }) => {
		const formData = await request.formData();
		const email = formData.get('email')?.toString() || '';
		const locale = getLocale();

		const service = container.getWaitlistService();
		const result = await service.joinWaitlist({ email, locale });

		if (result.isErr()) {
			return fail(400, {
				error: result.error.message,
				email
			});
		}

		return {
			success: true
		};
	}
} satisfies Actions;
