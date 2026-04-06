use super::deserialize::parser_error_to_de_error;
use super::UsageTelemetryData;
use crate::acp::parsers::{get_parser, AgentType};

pub(crate) fn parse_usage_telemetry_data_with_agent<E>(
    data: &serde_json::Value,
    fallback_session_id: Option<&str>,
    agent: AgentType,
) -> Result<UsageTelemetryData, E>
where
    E: serde::de::Error,
{
    let parser = get_parser(agent);
    let parsed = parser
        .parse_usage_telemetry(data, fallback_session_id)
        .map_err(parser_error_to_de_error::<E>)?;

    Ok(parsed.into_usage_telemetry_data())
}
