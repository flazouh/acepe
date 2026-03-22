pub(crate) fn classify_mutating_sql(sql: &str) -> bool {
    let tokens = tokenize_sql_keywords(sql);
    if tokens.is_empty() {
        return false;
    }

    let mutating_keywords = [
        "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "REPLACE", "GRANT",
        "REVOKE", "MERGE",
    ];

    if mutating_keywords
        .iter()
        .any(|keyword| *keyword == tokens[0])
    {
        return true;
    }

    tokens[0] == "WITH"
        && tokens
            .iter()
            .any(|token| mutating_keywords.iter().any(|keyword| keyword == token))
}

pub(crate) fn tokenize_sql_keywords(sql: &str) -> Vec<String> {
    enum ScanState {
        Normal,
        SingleQuoted,
        DoubleQuoted,
        LineComment,
        BlockComment,
    }

    let mut state = ScanState::Normal;
    let chars = sql.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        let current_char = chars[index];
        let next_char = chars.get(index + 1).copied();

        match state {
            ScanState::Normal => {
                if current_char == '-' && next_char == Some('-') {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                    state = ScanState::LineComment;
                    index += 2;
                    continue;
                }
                if current_char == '/' && next_char == Some('*') {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                    state = ScanState::BlockComment;
                    index += 2;
                    continue;
                }
                if current_char == '\'' {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                    state = ScanState::SingleQuoted;
                    index += 1;
                    continue;
                }
                if current_char == '"' {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                    state = ScanState::DoubleQuoted;
                    index += 1;
                    continue;
                }

                if current_char.is_ascii_alphabetic() || current_char == '_' {
                    current.push(current_char.to_ascii_uppercase());
                } else if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }

                index += 1;
            }
            ScanState::SingleQuoted => {
                if current_char == '\'' {
                    if next_char == Some('\'') {
                        index += 2;
                        continue;
                    }
                    state = ScanState::Normal;
                }
                index += 1;
            }
            ScanState::DoubleQuoted => {
                if current_char == '"' {
                    if next_char == Some('"') {
                        index += 2;
                        continue;
                    }
                    state = ScanState::Normal;
                }
                index += 1;
            }
            ScanState::LineComment => {
                if current_char == '\n' {
                    state = ScanState::Normal;
                }
                index += 1;
            }
            ScanState::BlockComment => {
                if current_char == '*' && next_char == Some('/') {
                    state = ScanState::Normal;
                    index += 2;
                    continue;
                }
                index += 1;
            }
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

pub(crate) fn quote_ident_double(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(crate) fn quote_ident_backtick(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

pub(crate) fn build_qualified_table_name(
    engine: &str,
    schema_name: &str,
    table_name: &str,
) -> String {
    if engine == "mysql" {
        if schema_name.trim().is_empty() {
            return quote_ident_backtick(table_name);
        }
        return format!(
            "{}.{}",
            quote_ident_backtick(schema_name),
            quote_ident_backtick(table_name)
        );
    }

    if schema_name.trim().is_empty() {
        return quote_ident_double(table_name);
    }

    format!(
        "{}.{}",
        quote_ident_double(schema_name),
        quote_ident_double(table_name)
    )
}

pub(crate) fn normalize_explorer_window(offset: i64, limit: i64) -> (i64, i64) {
    let safe_offset = offset.max(0);
    let safe_limit = limit.clamp(1, 500);
    (safe_offset, safe_limit)
}
