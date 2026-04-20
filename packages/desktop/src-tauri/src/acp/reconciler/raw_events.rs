//! Raw parser-level tool frames before provider semantic reduction (Unit 2+).
//! Full event enums land with provider reducer wiring (Unit 3).

use serde_json::Value;

/// Minimal frame for tool identity + raw JSON arguments from a parser.
#[expect(dead_code, reason = "Reserved for provider reducer raw-frame wiring.")]
#[derive(Debug, Clone)]
pub struct RawToolCallFrame<'a> {
    pub tool_call_id: &'a str,
    pub name_hint: Option<&'a str>,
    pub kind_hint: Option<&'a str>,
    pub title: Option<&'a str>,
    pub arguments: &'a Value,
}
