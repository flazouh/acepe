import type { PageServerLoad, Actions } from './$types';
import { WaitlistRepositoryImpl } from '$lib/server/infrastructure/repositories/WaitlistRepositoryImpl';

const ITEMS_PER_PAGE = 50;

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1'));
	const offset = (page - 1) * ITEMS_PER_PAGE;

	const repo = new WaitlistRepositoryImpl();

	const allEntriesResult = await repo.getAll(ITEMS_PER_PAGE, offset);
	const totalCountResult = await repo.getTotalCount();

	const entries = allEntriesResult.isOk() ? allEntriesResult.value : [];
	const totalCount = totalCountResult.isOk() ? totalCountResult.value : 0;
	const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

	return {
		entries,
		page,
		totalCount,
		totalPages,
		itemsPerPage: ITEMS_PER_PAGE
	};
};

export const actions = {
	export: async () => {
		const repo = new WaitlistRepositoryImpl();
		const csvResult = await repo.exportToCSV();

		if (csvResult.isErr()) {
			return {
				error: csvResult.error.message
			};
		}

		return {
			csv: csvResult.value
		};
	}
} satisfies Actions;
