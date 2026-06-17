pub fn wall_clock_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}
