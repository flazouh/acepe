//! End-to-end verification: replay the real Copilot permission payload
//! through the fixed normalizer chain.

#[test]
fn copilot_session_fib_c_edit_parses_full_file_content() {
    use serde_json::json;

    // Exact rawInput from session 2db3b7c7 (first edit permission).
    let raw = json!({
        "diff": "\ndiff --git a/Users/alex/Documents/sandbox/fib-c/test_fib.c b/Users/alex/Documents/sandbox/fib-c/test_fib.c\ncreate file mode 100644\nindex 0000000..0000000\n--- a/dev/null\n+++ b/Users/alex/Documents/sandbox/fib-c/test_fib.c\n@@ -1,0 +1,53 @@\n+#include <stdio.h>\n+#include <stdlib.h>\n+#include \"fib.h\"\n+\n+static int failures = 0;\n+static int total = 0;\n+\n+#define ASSERT_EQ(expected, actual) do { \\\n+    total++; \\\n+    unsigned long long _e = (expected); \\\n+    unsigned long long _a = (actual); \\\n+    if (_e != _a) { \\\n+        failures++; \\\n+        fprintf(stderr, \"FAIL %s:%d: expected %llu, got %llu\\n\", \\\n+                __FILE__, __LINE__, _e, _a); \\\n+    } \\\n+} while (0)\n+\n+static void test_base_cases(void) {\n+    ASSERT_EQ(0ULL, fib(0));\n+    ASSERT_EQ(1ULL, fib(1));\n+}\n+\n+static void test_small_values(void) {\n+    ASSERT_EQ(1ULL, fib(2));\n+    ASSERT_EQ(2ULL, fib(3));\n+    ASSERT_EQ(3ULL, fib(4));\n+    ASSERT_EQ(5ULL, fib(5));\n+    ASSERT_EQ(8ULL, fib(6));\n+    ASSERT_EQ(13ULL, fib(7));\n+}\n+\n+static void test_larger_values(void) {\n+    ASSERT_EQ(55ULL, fib(10));\n+    ASSERT_EQ(6765ULL, fib(20));\n+    ASSERT_EQ(832040ULL, fib(30));\n+}\n+\n+static void test_large_value_no_overflow(void) {\n+    // fib(93) = 12200160415121876738 fits in unsigned 64-bit\n+    ASSERT_EQ(12200160415121876738ULL, fib(93));\n+}\n+\n+int main(void) {\n+    test_base_cases();\n+    test_small_values();\n+    test_larger_values();\n+    test_large_value_no_overflow();\n+\n+    printf(\"%d/%d tests passed\\n\", total - failures, total);\n+    return failures == 0 ? 0 : 1;\n+}\n+\n",
        "fileName": "/Users/alex/Documents/sandbox/fib-c/test_fib.c"
    });

    let result = crate::acp::parsers::edit_normalizers::copilot::parse_edit_arguments(&raw);

    match result {
        crate::acp::session_update::ToolArguments::Edit { edits } => {
            assert_eq!(edits.len(), 1, "expected single edit entry");
            let entry = &edits[0];
            assert_eq!(
                entry.file_path.as_deref(),
                Some("Users/alex/Documents/sandbox/fib-c/test_fib.c"),
                "file_path should be extracted from +++ header"
            );
            assert!(
                entry.old_string.is_none(),
                "create-file diff must produce no old_string, got {:?}",
                entry.old_string
            );
            let new_string = entry
                .new_string
                .as_deref()
                .expect("new_string should be populated for create-file diff");
            assert!(
                new_string.starts_with("#include <stdio.h>"),
                "new_string should start with the first added line"
            );
            assert!(
                new_string.contains("ASSERT_EQ(12200160415121876738ULL, fib(93));"),
                "new_string should preserve large-value assertion"
            );
            assert!(
                new_string.contains("return failures == 0 ? 0 : 1;"),
                "new_string should include the main() return"
            );
            assert_eq!(
                entry.content.as_deref(),
                entry.new_string.as_deref(),
                "content should mirror new_string for a create-file edit"
            );
        }
        other => panic!("expected ToolArguments::Edit, got {other:?}"),
    }
}
