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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LayoutIndex {
    rows: Vec<RowLayout>,
    index_by_row_id: BTreeMap<String, usize>,
    offsets: Vec<u64>,
    total_height_px: u64,
}

impl LayoutIndex {
    #[must_use]
    pub fn new(rows: Vec<RowLayout>) -> Self {
        let mut index = Self {
            rows,
            index_by_row_id: BTreeMap::new(),
            offsets: Vec::new(),
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
        self.offsets.get(*index).copied()
    }

    #[must_use]
    pub fn row_at_offset(&self, offset_px: u64) -> Option<&RowLayout> {
        if self.rows.is_empty() {
            return None;
        }

        let capped_offset = offset_px.min(self.total_height_px.saturating_sub(1));
        let index = self
            .offsets
            .partition_point(|offset| *offset <= capped_offset)
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

        row.confirmed_height_px = Some(confirmed_height_px);
        self.rebuild_offsets_only();
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
        self.offsets.clear();
        let mut current_offset = 0_u64;
        for row in &self.rows {
            self.offsets.push(current_offset);
            current_offset = current_offset.saturating_add(u64::from(row.height_px()));
        }
        self.total_height_px = current_offset;
    }

    fn index_at_or_before_offset(&self, offset_px: u64) -> usize {
        self.offsets
            .partition_point(|offset| *offset <= offset_px)
            .saturating_sub(1)
    }

    fn index_after_offset(&self, offset_px: u64) -> usize {
        self.offsets
            .partition_point(|offset| *offset < offset_px)
            .min(self.rows.len())
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
}
