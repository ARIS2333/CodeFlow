import unittest

from code_analysis import CodeAnalysisError, analyze_code


class CodeAnalysisTests(unittest.TestCase):
    def test_java_extracts_nested_control_and_process_facts(self):
        result = analyze_code(
            "java",
            """public int total(int[] values) {
  int sum = 0;
  for (int value : values) {
    if (value > 0) sum += value;
  }
  return sum;
}
""",
        )

        self.assertEqual(result["parseStatus"], "clean")
        self.assertEqual([item["name"] for item in result["functions"]], ["total"])
        constructs = [fact["construct"] for fact in result["facts"]]
        self.assertEqual(
            constructs,
            ["local-variable-declaration", "for-each", "if", "expression", "return"],
        )
        inner_if = next(fact for fact in result["facts"] if fact["construct"] == "if")
        loop = next(fact for fact in result["facts"] if fact["construct"] == "for-each")
        self.assertEqual(inner_if["parentAnchor"], loop["anchor"])
        self.assertEqual(inner_if["branch"], "body")

    def test_java_recovers_a_missing_parenthesis(self):
        result = analyze_code(
            "java",
            """public int sign(int value) {
  if (value > 0 {
    return 1;
  }
  return 0;
}
""",
        )

        self.assertEqual(result["parseStatus"], "recovered")
        self.assertTrue(
            any(
                issue["kind"] == "missing-token" and issue.get("expected") == ")"
                for issue in result["syntaxIssues"]
            )
        )
        self.assertTrue(any(fact["construct"] == "if" for fact in result["facts"]))
        self.assertEqual(
            sum(fact["construct"] == "return" for fact in result["facts"]),
            2,
        )

    def test_java_for_header_does_not_duplicate_its_initializer(self):
        result = analyze_code(
            "java",
            """public int sum(int n) {
  int total = 0;
  for (int i = 0; i < n; i++) { total += i; }
  return total;
}
""",
        )

        constructs = [fact["construct"] for fact in result["facts"]]
        self.assertEqual(
            constructs,
            ["local-variable-declaration", "for", "expression", "return"],
        )

    def test_java_do_while_fact_keeps_the_condition(self):
        result = analyze_code(
            "java",
            "public int f(int n) { do { n--; } while (n > 0); return n; }",
        )

        loop = next(
            fact for fact in result["facts"] if fact["construct"] == "do-while"
        )
        self.assertIn("while (n > 0)", loop["text"])

    def test_python_preserves_elif_and_else_branch_context(self):
        result = analyze_code(
            "python",
            """def classify(value):
    if value > 0:
        return 1
    elif value == 0:
        return 0
    else:
        return -1
""",
        )

        self.assertEqual(result["parseStatus"], "clean")
        if_fact = next(fact for fact in result["facts"] if fact["construct"] == "if")
        elif_fact = next(
            fact for fact in result["facts"] if fact["construct"] == "else-if"
        )
        self.assertEqual(elif_fact["parentAnchor"], if_fact["anchor"])
        self.assertEqual(elif_fact["branch"], "false")
        returns = [fact for fact in result["facts"] if fact["construct"] == "return"]
        self.assertEqual(len(returns), 3)
        self.assertEqual(returns[-1]["parentAnchor"], elif_fact["anchor"])
        self.assertEqual(returns[-1]["branch"], "false")

    def test_python_reports_but_does_not_crash_on_incomplete_code(self):
        result = analyze_code(
            "python",
            """def positive(value):
    if value > 0
        return True
    return False
""",
        )

        self.assertEqual(result["parseStatus"], "recovered")
        self.assertGreaterEqual(len(result["syntaxIssues"]), 1)

    def test_marks_direct_code_after_return_as_not_required(self):
        result = analyze_code(
            "java",
            "public int f() { return 1; int never = 2; }",
        )

        returned, unreachable = result["facts"]
        self.assertTrue(returned["flowchartRequired"])
        self.assertFalse(unreachable["flowchartRequired"])

    def test_missing_java_brace_before_else_if_triggers_inferred_generation(self):
        result = analyze_code(
            "java",
            """public boolean in1To10(int n, boolean outsideMode) {
if (OutsideMode = true) {
if (n <= 1) {
return true;
} else {
return false;
} else if (n >= 1 && n <= 10) {
    return true;
} else {
    return false;
}
}""",
        )

        # The frontend must choose inference for this response, not force the
        # model to honor recovery-dependent classifications such as "else if"
        # being treated as a local declaration by the current Java grammar.
        self.assertEqual(result["parseStatus"], "recovered")
        self.assertTrue(result["syntaxIssues"])

    def test_missing_java_inner_brace_reports_diagnostics_outside_graph_facts(self):
        result = analyze_code(
            "java",
            """class Solution {
    public boolean isPalindrome(String s) {
        // 预处理
        String cleanedStr = s.toLowerCase().replaceAll("[^a-z0-9]", "");
        int len = cleanedStr.length();
        for (int i = 0; i < len / 2; i++) {
            char leftChar = cleanedStr.charAt(i);
            char rightChar = cleanedStr.charAt(len - 1 - i);
            if (leftChar != rightChar) {
                return false;
        }
        return true;
    }
}""",
        )

        self.assertEqual(result["parseStatus"], "recovered")
        missing = [issue for issue in result["syntaxIssues"]
                   if issue["kind"] == "missing-token" and issue.get("expected") == "}"]
        self.assertTrue(missing)
        # Graph-level diagnostics must survive even if no node can be marked.
        self.assertTrue(any(
            not any(fact["startByte"] <= issue["startByte"] <= fact["endByte"]
                    for fact in result["facts"])
            for issue in missing
        ))

    def test_python_assignment_in_condition_triggers_inferred_generation(self):
        result = analyze_code(
            "python",
            "def f(n):\n    if n = 1:\n        return True\n    return False\n",
        )
        self.assertEqual(result["parseStatus"], "recovered")
        self.assertTrue(result["syntaxIssues"])

    def test_rejects_unsupported_language(self):
        with self.assertRaises(CodeAnalysisError):
            analyze_code("javascript", "function f() {}")


if __name__ == "__main__":
    unittest.main()
