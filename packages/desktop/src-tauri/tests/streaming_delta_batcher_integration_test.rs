//! Integration test for streaming delta batching behavior.
//!
//! Replays interleaved Claude Code message chunks that share the same
//! `message_id` but belong to different `part_id` streams.

use acepe_lib::acp::session_update::{ContentChunk, SessionUpdate};
use acepe_lib::acp::streaming_delta_batcher::StreamingDeltaBatcher;
use acepe_lib::acp::types::ContentBlock;
use std::collections::BTreeMap;

fn make_message_chunk(
    session_id: &str,
    message_id: &str,
    part_id: &str,
    text: &str,
) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: text.to_string(),
            },
        },
        part_id: Some(part_id.to_string()),
        message_id: Some(message_id.to_string()),
        session_id: Some(session_id.to_string()),
    }
}

#[test]
fn replay_interleaved_parts_preserves_part_boundaries() {
    let mut batcher = StreamingDeltaBatcher::new();
    let session_id = "session-1";
    let message_id = "msg-1";

    // Mirrors the real-world failure mode: interleaved chunks from multiple
    // parts under the same message_id.
    let interleaved_chunks = vec![
        ("part-a", "Now the full"),
        ("part-b", " picture.est centr"),
        ("part-a", " picture."),
        ("part-b", "alized fix"),
        ("part-a", " The clean"),
        ("part-b", " is to add"),
        ("part-a", " Let me update:"),
        ("part-b", " `toolDisplayState`."),
    ];

    let mut emitted_updates: Vec<SessionUpdate> = Vec::new();
    for (part_id, text) in &interleaved_chunks {
        emitted_updates
            .extend(batcher.process(make_message_chunk(session_id, message_id, part_id, text)));
    }
    emitted_updates.extend(batcher.process_turn_complete(session_id));

    let mut text_by_part: BTreeMap<String, String> = BTreeMap::new();
    let mut turn_complete_count = 0usize;

    for update in emitted_updates {
        match update {
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id: emitted_message_id,
                session_id: emitted_session_id,
            } => {
                assert_eq!(emitted_session_id.as_deref(), Some(session_id));
                assert_eq!(emitted_message_id.as_deref(), Some(message_id));

                let key = part_id.expect("part_id must be present for replay chunks");
                let text = match chunk.content {
                    ContentBlock::Text { text } => text,
                    _ => panic!("expected text content"),
                };
                text_by_part.entry(key).or_default().push_str(&text);
            }
            SessionUpdate::TurnComplete {
                session_id: completed_session_id,
            } => {
                assert_eq!(completed_session_id.as_deref(), Some(session_id));
                turn_complete_count += 1;
            }
            _ => {}
        }
    }

    let expected_part_a: String = interleaved_chunks
        .iter()
        .filter(|(part_id, _)| *part_id == "part-a")
        .map(|(_, text)| *text)
        .collect();
    let expected_part_b: String = interleaved_chunks
        .iter()
        .filter(|(part_id, _)| *part_id == "part-b")
        .map(|(_, text)| *text)
        .collect();

    assert_eq!(
        turn_complete_count, 1,
        "turn completion should be emitted once"
    );
    assert_eq!(
        text_by_part.get("part-a").map(String::as_str),
        Some(expected_part_a.as_str())
    );
    assert_eq!(
        text_by_part.get("part-b").map(String::as_str),
        Some(expected_part_b.as_str())
    );
    assert_eq!(
        text_by_part.len(),
        2,
        "only the two expected parts should exist"
    );
}
