use super::deserialize::parser_error_to_de_error;
use super::UsageTelemetryData;
use crate::acp::agent_context::current_agent;
use crate::acp::parsers::get_parser;

pub(crate) fn parse_usage_telemetry_data<E>(
    data: &serde_json::Value,
    fallback_session_id: Option<&str>,
) -> Result<UsageTelemetryData, E>
where
    E: serde::de::Error,
{
    let parser = get_parser(current_agent());
    let parsed = parser
        .parse_usage_telemetry(data, fallback_session_id)
        .map_err(parser_error_to_de_error::<E>)?;

    Ok(parsed.into_usage_telemetry_data())
}
