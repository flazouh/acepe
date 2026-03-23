<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function downloadCSV(csv: string) {
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `waitlist-${new Date().toISOString().split('T')[0]}.csv`;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	}

	const confirmedCount = $derived(data.entries.filter((e) => e.emailConfirmed).length);
	const confirmationRate = $derived(
		data.totalCount > 0 ? Math.round((confirmedCount / data.totalCount) * 100) : 0
	);
</script>

<div class="min-h-screen bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a]">
	<!-- Header -->
	<header class="border-b border-white/10 px-6 py-6">
		<div class="mx-auto max-w-7xl">
			<h1 class="text-3xl font-bold text-white">{m.admin_dashboard_title()}</h1>
			<p class="mt-2 text-white/60">Manage your waitlist entries and view confirmations</p>
		</div>
	</header>

	<main class="mx-auto max-w-7xl space-y-6 px-6 py-8">
		<!-- Stats -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div class="rounded-lg border border-white/10 bg-white/5 p-6">
				<p class="text-sm font-medium text-white/60">{m.admin_stats_total()}</p>
				<p class="mt-2 text-3xl font-bold text-white">{data.totalCount}</p>
			</div>
			<div class="rounded-lg border border-white/10 bg-white/5 p-6">
				<p class="text-sm font-medium text-white/60">{m.admin_stats_confirmed()}</p>
				<p class="mt-2 text-3xl font-bold text-green-400">{confirmedCount}</p>
			</div>
			<div class="rounded-lg border border-white/10 bg-white/5 p-6">
				<p class="text-sm font-medium text-white/60">{m.admin_stats_rate()}</p>
				<p class="mt-2 text-3xl font-bold text-white">{confirmationRate}%</p>
			</div>
		</div>

		<!-- Export Button -->
		<div class="flex justify-end">
			<form method="POST" action="?/export">
				<button
					type="submit"
					class="inline-flex h-11 items-center justify-center rounded-lg bg-white px-6 font-medium text-black transition-colors hover:bg-white/90"
				>
					{m.admin_export()}
				</button>
			</form>
		</div>

		<!-- Table -->
		<div class="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02]">
			<table class="w-full">
				<thead>
					<tr class="border-b border-white/10">
						<th class="px-6 py-4 text-left text-sm font-semibold text-white/80">
							{m.admin_email()}
						</th>
						<th class="px-6 py-4 text-left text-sm font-semibold text-white/80">
							{m.admin_confirmed()}
						</th>
						<th class="px-6 py-4 text-left text-sm font-semibold text-white/80">
							{m.admin_created()}
						</th>
						<th class="px-6 py-4 text-left text-sm font-semibold text-white/80">
							{m.admin_confirmed_at()}
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-white/10">
					{#each data.entries as entry (entry.id)}
						<tr class="transition-colors hover:bg-white/[0.03]">
							<td class="px-6 py-4 text-sm text-white/80">{entry.email}</td>
							<td class="px-6 py-4 text-sm">
								{#if entry.emailConfirmed}
									<span
										class="inline-flex items-center rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400"
									>
										✓ {m.admin_confirmed()}
									</span>
								{:else}
									<span
										class="inline-flex items-center rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-400"
									>
										Pending
									</span>
								{/if}
							</td>
							<td class="px-6 py-4 text-sm text-white/60">
								{formatDate(entry.createdAt)}
							</td>
							<td class="px-6 py-4 text-sm text-white/60">
								{entry.confirmedAt ? formatDate(entry.confirmedAt) : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between">
			<p class="text-sm text-white/60">
				Showing {(data.page - 1) * data.itemsPerPage + 1} to {Math.min(
					data.page * data.itemsPerPage,
					data.totalCount
				)} of {data.totalCount} entries
			</p>

			<div class="flex gap-2">
				{#if data.page > 1}
					<a
						href="?page={data.page - 1}"
						class="inline-flex h-10 items-center justify-center rounded-lg bg-white/10 px-4 text-white transition-colors hover:bg-white/20"
					>
						← Previous
					</a>
				{/if}

				{#if data.page < data.totalPages}
					<a
						href="?page={data.page + 1}"
						class="inline-flex h-10 items-center justify-center rounded-lg bg-white/10 px-4 text-white transition-colors hover:bg-white/20"
					>
						Next →
					</a>
				{/if}
			</div>
		</div>
	</main>
</div>
