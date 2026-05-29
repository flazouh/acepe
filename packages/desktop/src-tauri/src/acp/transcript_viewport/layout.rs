use crate::acp::transcript_viewport::row::TranscriptViewportRow;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const DEFAULT_ESTIMATED_ROW_HEIGHT_PX: u32 = 120;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RowLayout {
    pub row_id: String,
    pub version: String,
    pub estimated_height_px: u32,
    pub confirmed_height_px: Option<u32>,
    pub anchor_eligible: bool,
}

impl RowLayout {
    #[must_use]
    pub fn from_viewport_row(row: &TranscriptViewportRow) -> Self {
        Self {
            row_id: row.row_id.clone(),
            version: row.version.clone(),
            estimated_height_px: DEFAULT_ESTIMATED_ROW_HEIGHT_PX,
            confirmed_height_px: None,
            anchor_eligible: row.anchor_eligible,
        }
    }

    #[must_use]
    pub fn height_px(&self) -> u32 {
        self.confirmed_height_px.unwrap_or(self.estimated_height_px)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeightConfirmationOutcome {
    Accepted,
    StaleVersion,
    MissingRow,
}

/// Fenwick (binary indexed) tree over per-row heights.
///
/// Backs `LayoutIndex` so a single height confirmation is an O(log N) point
/// update instead of an O(N) offset rebuild. `prefix_sum(i)` returns the
/// cumulative height of the first `i` rows — i.e. the absolute pixel offset of
/// row `i` — which is the single source for every offset/row-at-offset query.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct FenwickTree {
    /// 1-indexed; `tree[0]` is unused. `tree[p]` covers heights `[p - lowbit, p)`.
    tree: Vec<u64>,
    len: usize,
}

impl FenwickTree {
    fn from_heights(heights: &[u64]) -> Self {
        let len = heights.len();
        let mut tree = vec![0_u64; len + 1];
        for (i, &height) in heights.iter().enumerate() {
            let idx = i + 1;
            tree[idx] = tree[idx].saturating_add(height);
            let parent = idx + lowbit(idx);
            if parent <= len {
                let carry = tree[idx];
                tree[parent] = tree[parent].saturating_add(carry);
            }
        }
        Self { tree, len }
    }

    /// Apply a signed delta to the height at 0-based position `pos`.
    fn add(&mut self, pos: usize, delta: i64) {
        let mut idx = pos + 1;
        while idx <= self.len {
            let updated = i64::try_from(self.tree[idx]).unwrap_or(i64::MAX) + delta;
            self.tree[idx] = u64::try_from(updated.max(0)).unwrap_or(0);
            idx += lowbit(idx);
        }
    }

    /// Sum of the first `count` heights (= absolute offset of row `count`).
    fn prefix_sum(&self, count: usize) -> u64 {
        let mut idx = count.min(self.len);
        let mut sum = 0_u64;
        while idx > 0 {
            sum = sum.saturating_add(self.tree[idx]);
            idx -= lowbit(idx);
        }
        sum
    }
}

const fn lowbit(idx: usize) -> usize {
    idx & idx.wrapping_neg()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LayoutIndex {
    rows: Vec<RowLayout>,
    index_by_row_id: BTreeMap<String, usize>,
    offsets: FenwickTree,
    total_height_px: u64,
}

impl LayoutIndex {
    #[must_use]
    pub fn new(rows: Vec<RowLayout>) -> Self {
        let mut index = Self {
            rows,
            index_by_row_id: BTreeMap::new(),
            offsets: FenwickTree::default(),
            total_height_px: 0,
        };
        index.rebuild();
        index
    }

    #[must_use]
    pub fn from_viewport_rows(rows: &[TranscriptViewportRow]) -> Self {
        Self::new(rows.iter().map(RowLayout::from_viewport_row).collect())
    }

    #[must_use]
    pub fn from_viewport_rows_preserving(
        rows: &[TranscriptViewportRow],
        previous: &LayoutIndex,
    ) -> Self {
        Self::new(
            rows.iter()
                .map(|row| {
                    let mut next = RowLayout::from_viewport_row(row);
                    if let Some(previous_row) = previous.row(&row.row_id) {
                        if previous_row.version == row.version {
                            next.confirmed_height_px = previous_row.confirmed_height_px;
                        }
                    }
                    next
                })
                .collect(),
        )
    }

    #[must_use]
    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    #[must_use]
    pub fn total_height_px(&self) -> u64 {
        self.total_height_px
    }

    #[must_use]
    pub fn rows(&self) -> &[RowLayout] {
        self.rows.as_slice()
    }

    #[must_use]
    pub fn row(&self, row_id: &str) -> Option<&RowLayout> {
        self.index_by_row_id
            .get(row_id)
            .and_then(|index| self.rows.get(*index))
    }

    #[must_use]
    pub fn row_offset_px(&self, row_id: &str) -> Option<u64> {
        let index = self.index_by_row_id.get(row_id)?;
        Some(self.offsets.prefix_sum(*index))
    }

    /// Absolute pixel offset of the row at `index` (cumulative height of rows
    /// `[0, index)`). Clamps to the row count so a buffer-slice end index maps
    /// to `total_height_px`.
    #[must_use]
    pub fn offset_at_index(&self, index: usize) -> u64 {
        self.offsets.prefix_sum(index.min(self.rows.len()))
    }

    #[must_use]
    pub fn row_at_offset(&self, offset_px: u64) -> Option<&RowLayout> {
        if self.rows.is_empty() {
            return None;
        }

        let capped_offset = offset_px.min(self.total_height_px.saturating_sub(1));
        let index = self
            .partition_point_offset_le(capped_offset)
            .saturating_sub(1);
        self.rows.get(index)
    }

    #[must_use]
    pub fn visible_range(
        &self,
        viewport_offset_px: u64,
        viewport_height_px: u32,
        overscan_rows: usize,
    ) -> std::ops::Range<usize> {
        if self.rows.is_empty() || viewport_height_px == 0 {
            return 0..0;
        }

        let start_offset = viewport_offset_px.min(self.total_height_px);
        let end_offset = start_offset
            .saturating_add(u64::from(viewport_height_px))
            .min(self.total_height_px);
        let start = self.index_at_or_before_offset(start_offset);
        let end = self.index_after_offset(end_offset).max(start + 1);

        start.saturating_sub(overscan_rows)..(end + overscan_rows).min(self.rows.len())
    }

    pub fn confirm_height(
        &mut self,
        row_id: &str,
        version: &str,
        confirmed_height_px: u32,
    ) -> HeightConfirmationOutcome {
        let Some(index) = self.index_by_row_id.get(row_id).copied() else {
            return HeightConfirmationOutcome::MissingRow;
        };
        let Some(row) = self.rows.get_mut(index) else {
            return HeightConfirmationOutcome::MissingRow;
        };
        if row.version != version {
            return HeightConfirmationOutcome::StaleVersion;
        }

        // Compute the height delta BEFORE mutating the row: `height_px()` reads
        // the confirmed height once set, so reading after would yield a zero
        // delta and a silent Fenwick no-op (offsets frozen at estimates).
        let previous_height = i64::from(row.height_px());
        row.confirmed_height_px = Some(confirmed_height_px);
        let delta = i64::from(confirmed_height_px) - previous_height;
        if delta != 0 {
            self.offsets.add(index, delta);
            let updated_total = i64::try_from(self.total_height_px).unwrap_or(i64::MAX) + delta;
            self.total_height_px = u64::try_from(updated_total.max(0)).unwrap_or(0);
        }
        HeightConfirmationOutcome::Accepted
    }

    #[must_use]
    pub fn nearest_anchor_row_id(&self, row_id: &str) -> Option<String> {
        let index = self.index_by_row_id.get(row_id).copied();
        let search_start = index.unwrap_or_else(|| self.rows.len().saturating_sub(1));

        for offset in 0..self.rows.len() {
            if let Some(left_index) = search_start.checked_sub(offset) {
                if let Some(row) = self.rows.get(left_index) {
                    if row.anchor_eligible {
                        return Some(row.row_id.clone());
                    }
                }
            }

            let right_index = search_start + offset;
            if right_index < self.rows.len() {
                if let Some(row) = self.rows.get(right_index) {
                    if row.anchor_eligible {
                        return Some(row.row_id.clone());
                    }
                }
            }
        }

        None
    }

    fn rebuild(&mut self) {
        self.index_by_row_id.clear();
        for (index, row) in self.rows.iter().enumerate() {
            self.index_by_row_id.insert(row.row_id.clone(), index);
        }
        self.rebuild_offsets_only();
    }

    fn rebuild_offsets_only(&mut self) {
        let heights: Vec<u64> = self.rows.iter().map(|row| u64::from(row.height_px())).collect();
        self.total_height_px = heights.iter().fold(0_u64, |acc, h| acc.saturating_add(*h));
        self.offsets = FenwickTree::from_heights(&heights);
    }

    /// Count of rows whose absolute offset is `<= offset_px`.
    ///
    /// Mirrors `offsets.partition_point(|o| *o <= offset_px)` over the previous
    /// flat-array representation, so all dependent queries are behavior-identical.
    fn partition_point_offset_le(&self, offset_px: u64) -> usize {
        let (mut lo, mut hi) = (0_usize, self.rows.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.offsets.prefix_sum(mid) <= offset_px {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    /// Count of rows whose absolute offset is `< offset_px`.
    fn partition_point_offset_lt(&self, offset_px: u64) -> usize {
        let (mut lo, mut hi) = (0_usize, self.rows.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.offsets.prefix_sum(mid) < offset_px {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    fn index_at_or_before_offset(&self, offset_px: u64) -> usize {
        self.partition_point_offset_le(offset_px).saturating_sub(1)
    }

    fn index_after_offset(&self, offset_px: u64) -> usize {
        self.partition_point_offset_lt(offset_px).min(self.rows.len())
    }
}

#[cfg(test)]
mod tests {
    use super::{HeightConfirmationOutcome, LayoutIndex, RowLayout};

    fn row(row_id: &str, height: u32, anchor_eligible: bool) -> RowLayout {
        RowLayout {
            row_id: row_id.to_string(),
            version: format!("{row_id}:v1"),
            estimated_height_px: height,
            confirmed_height_px: None,
            anchor_eligible,
        }
    }

    #[test]
    fn builds_total_height_and_row_offsets() {
        let layout = LayoutIndex::new(vec![
            row("row-1", 40, true),
            row("row-2", 50, true),
            row("row-3", 60, true),
        ]);

        assert_eq!(layout.row_count(), 3);
        assert_eq!(layout.total_height_px(), 150);
        assert_eq!(layout.row_offset_px("row-1"), Some(0));
        assert_eq!(layout.row_offset_px("row-2"), Some(40));
        assert_eq!(layout.row_offset_px("row-3"), Some(90));
    }

    #[test]
    fn offset_at_index_returns_cumulative_offsets_and_total_at_end() {
        let layout = LayoutIndex::new(vec![
            row("row-1", 40, true),
            row("row-2", 50, true),
            row("row-3", 60, true),
        ]);

        assert_eq!(layout.offset_at_index(0), 0);
        assert_eq!(layout.offset_at_index(1), 40);
        assert_eq!(layout.offset_at_index(2), 90);
        // End index (== row count) maps to total height.
        assert_eq!(layout.offset_at_index(3), 150);
        // Out-of-range clamps to total height.
        assert_eq!(layout.offset_at_index(99), 150);
    }

    #[test]
    fn queries_visible_range_with_bounded_overscan() {
        let layout = LayoutIndex::new(vec![
            row("row-1", 100, true),
            row("row-2", 100, true),
            row("row-3", 100, true),
            row("row-4", 100, true),
        ]);

        assert_eq!(layout.visible_range(150, 100, 1), 0..4);
        assert_eq!(layout.visible_range(250, 50, 0), 2..3);
    }

    #[test]
    fn accepts_current_height_confirmation_and_rejects_stale_version() {
        let mut layout = LayoutIndex::new(vec![row("row-1", 100, true), row("row-2", 100, true)]);

        assert_eq!(
            layout.confirm_height("row-1", "row-1:v1", 150),
            HeightConfirmationOutcome::Accepted
        );
        assert_eq!(layout.total_height_px(), 250);
        assert_eq!(
            layout.confirm_height("row-1", "row-1:v0", 10),
            HeightConfirmationOutcome::StaleVersion
        );
        assert_eq!(layout.total_height_px(), 250);
    }

    #[test]
    fn preserves_confirmed_heights_only_for_matching_versions() {
        let mut previous = LayoutIndex::new(vec![row("row-1", 100, true), row("row-2", 100, true)]);
        assert_eq!(
            previous.confirm_height("row-1", "row-1:v1", 160),
            HeightConfirmationOutcome::Accepted
        );
        assert_eq!(
            previous.confirm_height("row-2", "row-2:v1", 180),
            HeightConfirmationOutcome::Accepted
        );
        let rows = vec![
            RowLayout {
                row_id: "row-1".to_string(),
                version: "row-1:v1".to_string(),
                estimated_height_px: 100,
                confirmed_height_px: None,
                anchor_eligible: true,
            },
            RowLayout {
                row_id: "row-2".to_string(),
                version: "row-2:v2".to_string(),
                estimated_height_px: 100,
                confirmed_height_px: None,
                anchor_eligible: true,
            },
        ];
        let viewport_rows = rows
            .iter()
            .map(
                |row| crate::acp::transcript_viewport::TranscriptViewportRow {
                    row_id: row.row_id.clone(),
                    source_entry_id: row.row_id.clone(),
                    kind: crate::acp::transcript_viewport::TranscriptViewportRowKind::AssistantText,
                    version: row.version.clone(),
                    anchor_eligible: row.anchor_eligible,
                    active_streaming_tail: None,
                    operation_links: Vec::new(),
                    interaction_links: Vec::new(),
                    content:
                        crate::acp::transcript_viewport::TranscriptViewportRowContent::Transcript {
                            role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                            segments: Vec::new(),
                        },
                },
            )
            .collect::<Vec<_>>();

        let next = LayoutIndex::from_viewport_rows_preserving(viewport_rows.as_slice(), &previous);

        assert_eq!(
            next.row("row-1").and_then(|row| row.confirmed_height_px),
            Some(160)
        );
        assert_eq!(
            next.row("row-2").and_then(|row| row.confirmed_height_px),
            None
        );
        assert_eq!(next.total_height_px(), 280);
    }

    #[test]
    fn locates_row_at_logical_offset() {
        let layout = LayoutIndex::new(vec![row("row-1", 25, true), row("row-2", 75, true)]);

        assert_eq!(
            layout.row_at_offset(0).map(|row| row.row_id.as_str()),
            Some("row-1")
        );
        assert_eq!(
            layout.row_at_offset(25).map(|row| row.row_id.as_str()),
            Some("row-2")
        );
        assert_eq!(
            layout.row_at_offset(999).map(|row| row.row_id.as_str()),
            Some("row-2")
        );
    }

    #[test]
    fn finds_nearest_anchor_eligible_row() {
        let layout = LayoutIndex::new(vec![
            row("status-1", 20, false),
            row("row-1", 80, true),
            row("status-2", 20, false),
            row("row-2", 80, true),
        ]);

        assert_eq!(
            layout.nearest_anchor_row_id("status-2"),
            Some("row-1".to_string())
        );
        assert_eq!(
            layout.nearest_anchor_row_id("missing"),
            Some("row-2".to_string())
        );
    }

    #[test]
    fn visible_range_query_is_bounded_for_large_fixture() {
        let rows = (0..5_000)
            .map(|index| row(&format!("row-{index}"), 10, true))
            .collect();
        let layout = LayoutIndex::new(rows);

        assert_eq!(layout.visible_range(25_000, 100, 2), 2498..2512);
    }

    // Brute-force offsets matching the previous flat-array implementation.
    fn flat_offsets(heights: &[u64]) -> Vec<u64> {
        let mut offsets = Vec::with_capacity(heights.len());
        let mut acc = 0_u64;
        for &height in heights {
            offsets.push(acc);
            acc = acc.saturating_add(height);
        }
        offsets
    }

    fn flat_index_at_or_before(offsets: &[u64], offset_px: u64) -> usize {
        offsets
            .partition_point(|offset| *offset <= offset_px)
            .saturating_sub(1)
    }

    #[test]
    fn fenwick_offsets_match_flat_array_across_mixed_heights() {
        // Deterministic pseudo-random mixed heights (incl. a zero-height row).
        let heights: Vec<u32> = (0..257)
            .map(|i| ((i * 2_654_435_761_u64) % 200) as u32)
            .collect();
        let rows: Vec<RowLayout> = heights
            .iter()
            .enumerate()
            .map(|(i, &h)| row(&format!("row-{i}"), h, true))
            .collect();
        let layout = LayoutIndex::new(rows);

        let expected: Vec<u64> = flat_offsets(&heights.iter().map(|&h| u64::from(h)).collect::<Vec<_>>());
        let total: u64 = heights.iter().map(|&h| u64::from(h)).sum();
        assert_eq!(layout.total_height_px(), total);

        for (i, want) in expected.iter().enumerate() {
            assert_eq!(layout.row_offset_px(&format!("row-{i}")), Some(*want));
        }

        // row_at_offset parity at many probe offsets.
        for probe in (0..total).step_by(7) {
            let want = flat_index_at_or_before(&expected, probe.min(total.saturating_sub(1)));
            let got = layout
                .row_at_offset(probe)
                .map(|r| r.row_id.clone())
                .unwrap();
            assert_eq!(got, format!("row-{want}"), "row_at_offset mismatch at {probe}");
        }
    }

    #[test]
    fn reconfirming_a_row_updates_offsets_via_point_update() {
        // Guards the read-before-mutate ordering trap: a silent no-op fails here.
        let mut layout = LayoutIndex::new(vec![
            row("row-1", 100, true),
            row("row-2", 100, true),
            row("row-3", 100, true),
        ]);

        assert_eq!(
            layout.confirm_height("row-1", "row-1:v1", 150),
            HeightConfirmationOutcome::Accepted
        );
        assert_eq!(layout.row_offset_px("row-2"), Some(150));
        assert_eq!(layout.row_offset_px("row-3"), Some(250));
        assert_eq!(layout.total_height_px(), 350);

        // Re-confirm the same row to a smaller height (negative delta).
        assert_eq!(
            layout.confirm_height("row-1", "row-1:v1", 60),
            HeightConfirmationOutcome::Accepted
        );
        assert_eq!(layout.row_offset_px("row-2"), Some(60));
        assert_eq!(layout.row_offset_px("row-3"), Some(160));
        assert_eq!(layout.total_height_px(), 260);
    }

    #[test]
    fn point_updates_stay_correct_at_scale() {
        let count = 100_000usize;
        let rows = (0..count)
            .map(|index| row(&format!("row-{index}"), 10, true))
            .collect();
        let mut layout = LayoutIndex::new(rows);
        assert_eq!(layout.total_height_px(), (count as u64) * 10);

        // Confirm a spread of rows to non-estimate heights, then verify offsets
        // reflect the cumulative shift without any O(N) rebuild.
        for index in (0..count).step_by(9_973) {
            assert_eq!(
                layout.confirm_height(&format!("row-{index}"), &format!("row-{index}:v1"), 30),
                HeightConfirmationOutcome::Accepted
            );
        }

        // Independently recompute expected offsets from the confirmed set.
        let mut heights = vec![10_u64; count];
        for index in (0..count).step_by(9_973) {
            heights[index] = 30;
        }
        let expected = flat_offsets(&heights);
        for index in (0..count).step_by(4_001) {
            assert_eq!(
                layout.row_offset_px(&format!("row-{index}")),
                Some(expected[index]),
                "offset mismatch at row {index}"
            );
        }
        assert_eq!(
            layout.total_height_px(),
            heights.iter().sum::<u64>()
        );
    }
}
