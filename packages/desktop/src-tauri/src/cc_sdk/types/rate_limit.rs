//! Rate limit types.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Rate limit status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitStatus {
    /// Request allowed
    Allowed,
    /// Request allowed but approaching limit
    AllowedWarning,
    /// Request rejected due to rate limit
    Rejected,
}

/// Rate limit type
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RateLimitType {
    /// 5-hour rolling window
    #[serde(rename = "five_hour")]
    FiveHour,
    /// 7-day rolling window
    #[serde(rename = "seven_day")]
    SevenDay,
    /// 7-day Opus-specific window
    #[serde(rename = "seven_day_opus")]
    SevenDayOpus,
    /// 7-day Sonnet-specific window
    #[serde(rename = "seven_day_sonnet")]
    SevenDaySonnet,
    /// Overage window
    #[serde(rename = "overage")]
    Overage,
}

/// Rate limit information
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RateLimitInfo {
    /// Current rate limit status
    pub status: RateLimitStatus,
    /// When the rate limit resets (ISO 8601 or epoch)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
    /// Type of rate limit
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit_type: Option<RateLimitType>,
    /// Current utilization percentage (0.0 - 1.0)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub utilization: Option<f64>,
    /// Overage status
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_status: Option<String>,
    /// When overage resets
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_resets_at: Option<String>,
    /// Reason overage is disabled
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overage_disabled_reason: Option<String>,
    /// Raw rate limit data
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
}

