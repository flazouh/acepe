use crate::acp::session_state_engine::protocol::ViewportBufferDelta;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::transcript_viewport::{
    HeightConfirmationOutcome, TranscriptViewportRow, ViewportBufferSlice,
};

/// Prior buffer emission record used for classification (lock-held snapshot).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriorBufferEmission {
    pub start_index: usize,
    pub row_ids: Vec<String>,
    pub row_versions: Vec<String>,
    pub viewport_revision: i64,
}

/// Flags influencing buffer emission overrides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BufferEmissionFlags {
    pub height_outcome: Option<HeightConfirmationOutcome>,
    pub force_fresh: bool,
    pub has_prior: bool,
}

/// The three mutually-exclusive outcomes of a scroll/refill intent, classified
/// purely from the new buffer slice's index window relative to the previously
/// pushed buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferEmission {
    FreshPush,
    Delta,
    NoOp,
}

/// Pure decision over a lock-held snapshot: classifier plus override layers.
#[must_use]
pub fn decide_buffer_emission(
    prev: Option<&PriorBufferEmission>,
    slice: &ViewportBufferSlice,
    full_rows: &[TranscriptViewportRow],
    flags: BufferEmissionFlags,
) -> BufferEmission {
    let prev_window = prev.map(|record| (record.start_index, record.row_ids.len()));
    let mut emission = classify_buffer_transition(prev_window, slice);

    if matches!(emission, BufferEmission::NoOp)
        && prev
            .is_some_and(|record| record.viewport_revision != slice.viewport_revision)
    {
        emission = BufferEmission::FreshPush;
    }

    let height_accepted = matches!(flags.height_outcome, Some(HeightConfirmationOutcome::Accepted));
    if height_accepted && flags.has_prior {
        emission = BufferEmission::FreshPush;
    }

    if flags.force_fresh {
        emission = BufferEmission::FreshPush;
    }

    if matches!(emission, BufferEmission::Delta) {
        if let Some(record) = prev {
            if !buffer_delta_is_identity_consistent(
                record.start_index,
                &record.row_ids,
                &record.row_versions,
                full_rows,
                slice,
            ) {
                emission = BufferEmission::FreshPush;
            }
        }
    }

    emission
}

/// Classify a scroll/refill transition from the previously-pushed buffer window
/// to the freshly-computed `slice`.
#[must_use]
pub fn classify_buffer_transition(
    prev: Option<(usize, usize)>,
    slice: &ViewportBufferSlice,
) -> BufferEmission {
    let Some((prev_start_index, prev_len)) = prev else {
        return BufferEmission::FreshPush;
    };
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_len;
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;

    let overlaps = c_start < p_end && p_start < c_end;
    if !overlaps {
        return BufferEmission::FreshPush;
    }

    if c_start == p_start && c_end == p_end {
        return BufferEmission::NoOp;
    }

    BufferEmission::Delta
}

/// Incremental mutation from a previously-pushed buffer window to the current
/// `slice` over the full canonical `current_rows`.
#[must_use]
pub fn compute_buffer_delta(
    session_id: &str,
    graph_revision: SessionGraphRevision,
    emission_seq: u64,
    from_viewport_revision: i64,
    prev_start_index: usize,
    prev_row_ids: &[String],
    current_rows: &[TranscriptViewportRow],
    slice: &ViewportBufferSlice,
    scroll_anchor_correction_px: Option<i64>,
    scroll_top_target: Option<u64>,
) -> ViewportBufferDelta {
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_row_ids.len();
    let buffer_len = c_end.saturating_sub(c_start);

    let prepend_count = p_start.saturating_sub(c_start).min(buffer_len);
    let append_count = c_end.saturating_sub(p_end).min(buffer_len);

    let prepended_rows = current_rows[c_start..c_start + prepend_count].to_vec();
    let prepended_offsets_px = slice.offsets_px[0..prepend_count].to_vec();

    let append_local_start = buffer_len - append_count;
    let appended_rows = current_rows[c_end - append_count..c_end].to_vec();
    let appended_offsets_px = slice.offsets_px[append_local_start..buffer_len].to_vec();

    let removed_from_top = c_start.saturating_sub(p_start).min(prev_row_ids.len());
    let removed_from_bottom = p_end
        .saturating_sub(c_end)
        .min(prev_row_ids.len() - removed_from_top);
    let mut removed_row_ids = Vec::with_capacity(removed_from_top + removed_from_bottom);
    removed_row_ids.extend_from_slice(&prev_row_ids[0..removed_from_top]);
    removed_row_ids.extend_from_slice(&prev_row_ids[prev_row_ids.len() - removed_from_bottom..]);

    ViewportBufferDelta {
        session_id: session_id.to_string(),
        graph_revision,
        emission_seq,
        from_viewport_revision,
        to_viewport_revision: slice.viewport_revision,
        prepended_rows,
        prepended_offsets_px,
        appended_rows,
        appended_offsets_px,
        removed_row_ids,
        layout_row_count: slice.layout_row_count,
        total_height_px: slice.total_height_px,
        buffer_end_offset_px: slice.buffer_end_offset_px,
        scroll_anchor_correction_px,
        scroll_top_target,
        diagnostics: Vec::new(),
    }
}

#[must_use]
pub fn buffer_delta_is_identity_consistent(
    prev_start_index: usize,
    prev_row_ids: &[String],
    prev_row_versions: &[String],
    current_rows: &[TranscriptViewportRow],
    slice: &ViewportBufferSlice,
) -> bool {
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_row_ids.len();
    let buffer_len = c_end.saturating_sub(c_start);

    if c_end > current_rows.len() {
        return false;
    }

    let prepend_count = p_start.saturating_sub(c_start).min(buffer_len);
    let append_count = c_end.saturating_sub(p_end).min(buffer_len);
    let removed_from_top = c_start.saturating_sub(p_start).min(prev_row_ids.len());

    let curr_surv_start = c_start + prepend_count;
    let curr_surv_end = c_end.saturating_sub(append_count);
    let survivor_len = curr_surv_end.saturating_sub(curr_surv_start);

    if removed_from_top + survivor_len > prev_row_ids.len() {
        return false;
    }

    for k in 0..survivor_len {
        let current = &current_rows[curr_surv_start + k];
        if current.row_id != prev_row_ids[removed_from_top + k] {
            return false;
        }
        if current.version != prev_row_versions[removed_from_top + k] {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{
        buffer_delta_is_identity_consistent, classify_buffer_transition, compute_buffer_delta,
        decide_buffer_emission, BufferEmission, BufferEmissionFlags, PriorBufferEmission,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::transcript_viewport::{
        HeightConfirmationOutcome, TranscriptViewportRow, ViewportBufferSlice, ViewportMode,
    };

    fn sample_slice(start: usize, end: usize, revision: i64) -> ViewportBufferSlice {
        ViewportBufferSlice {
            buffer_start_index: start,
            buffer_end_index: end,
            layout_row_count: end,
            total_height_px: 1000,
            buffer_end_offset_px: 900,
            offsets_px: vec![0; end - start],
            mode: ViewportMode::FollowingTail,
            viewport_revision: revision,
            viewport_offset_px: 0,
        }
    }

    fn sample_row(index: usize) -> TranscriptViewportRow {
        use crate::acp::transcript_projection::TranscriptEntryRole;
        use crate::acp::transcript_viewport::{
            TranscriptViewportRowContent, TranscriptViewportRowKind,
        };
        TranscriptViewportRow {
            row_id: format!("transcript:row-{index}"),
            source_entry_id: format!("row-{index}"),
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("v-{index}"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: Vec::new(),
            },
        }
    }

    #[test]
    fn classify_buffer_transition_no_prior_is_fresh_push() {
        let slice = sample_slice(4, 8, 1);
        assert_eq!(
            classify_buffer_transition(None, &slice),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn decide_buffer_emission_viewport_revision_advance_forces_fresh_push() {
        let slice = sample_slice(4, 8, 2);
        let prev = PriorBufferEmission {
            start_index: 4,
            row_ids: vec!["a".to_string(); 4],
            row_versions: vec!["v1".to_string(); 4],
            viewport_revision: 1,
        };
        assert_eq!(
            decide_buffer_emission(
                Some(&prev),
                &slice,
                &[],
                BufferEmissionFlags::default(),
            ),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn decide_buffer_emission_accepted_height_forces_fresh_push() {
        let slice = sample_slice(4, 8, 1);
        let prev = PriorBufferEmission {
            start_index: 4,
            row_ids: vec!["a".to_string(); 4],
            row_versions: vec!["v1".to_string(); 4],
            viewport_revision: 1,
        };
        assert_eq!(
            decide_buffer_emission(
                Some(&prev),
                &slice,
                &[],
                BufferEmissionFlags {
                    height_outcome: Some(HeightConfirmationOutcome::Accepted),
                    force_fresh: false,
                    has_prior: true,
                },
            ),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn decide_buffer_emission_identity_guard_forces_fresh_push() {
        let slice = sample_slice(1, 6, 1);
        let rows = vec![
            sample_row(0),
            sample_row(99),
            sample_row(1),
            sample_row(2),
            sample_row(3),
            sample_row(4),
        ];
        let prev = PriorBufferEmission {
            start_index: 0,
            row_ids: (0..5).map(|i| format!("transcript:row-{i}")).collect(),
            row_versions: (0..5).map(|i| format!("v-{i}")).collect(),
            viewport_revision: 1,
        };
        assert_eq!(
            decide_buffer_emission(Some(&prev), &slice, &rows, BufferEmissionFlags {
                has_prior: true,
                ..BufferEmissionFlags::default()
            }),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn compute_buffer_delta_scroll_down_appends_and_removes_top() {
        let slice = sample_slice(6, 10, 2);
        let rows: Vec<_> = (0..10).map(sample_row).collect();
        let prev_ids: Vec<_> = (4..8).map(|i| format!("transcript:row-{i}")).collect();
        let delta = compute_buffer_delta(
            "s",
            SessionGraphRevision::new(1, 1, 1),
            1,
            1,
            4,
            &prev_ids,
            &rows,
            &slice,
            None,
            None,
        );
        assert_eq!(delta.prepended_rows.len(), 0);
        assert_eq!(delta.appended_rows.len(), 2);
        assert_eq!(
            delta.removed_row_ids,
            vec!["transcript:row-4", "transcript:row-5"]
        );
    }

    #[test]
    fn buffer_delta_is_identity_consistent_detects_row_id_mismatch() {
        let slice = sample_slice(4, 8, 1);
        let rows: Vec<_> = (0..8).map(sample_row).collect();
        let ids: Vec<_> = (4..8).map(|i| format!("transcript:row-{i}")).collect();
        let versions: Vec<_> = (4..8).map(|i| format!("v-{i}")).collect();
        assert!(buffer_delta_is_identity_consistent(
            4, &ids, &versions, &rows, &slice,
        ));
        let mut wrong_ids = ids.clone();
        wrong_ids[3] = "transcript:row-WRONG".to_string();
        assert!(!buffer_delta_is_identity_consistent(
            4, &wrong_ids, &versions, &rows, &slice,
        ));
    }
}
