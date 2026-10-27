import unittest

from code_analysis import analyze_code
from python_execution_trace import PythonTraceError, trace_python, trace_pair


class PythonTraceTests(unittest.TestCase):
    def assert_path(self, code, call):
        trace = trace_python(code, call)
        graph = analyze_code("python", code)["studentFlowchart"]
        links = {(edge["source"], edge["target"]) for edge in graph["edges"]}
        ids = [step["nodeId"] for step in trace["steps"]]
        self.assertEqual(ids[0], "1")
        for hop in zip(ids, ids[1:]):
            self.assertIn(hop, links)
        return trace

    def test_for_loop_records_mutated_state_and_empty_loop_exit(self):
        code = """def maximum(nums):
    result = -1
    for value in nums:
        if value > result:
            result = value
    return result
"""
        trace = self.assert_path(code, "maximum([2, 7, 4])")
        self.assertEqual(trace["finalOutput"], "7")
        self.assertTrue(any(step["variables"].get("result") == "7" for step in trace["steps"]))
        self.assertEqual(self.assert_path(code, "maximum([])")["finalOutput"], "-1")

    def test_while_loop_and_early_return(self):
        code = """def unique(n):
    seen = set()
    while n > 0:
        digit = n % 10
        if digit in seen:
            return False
        seen.add(digit)
        n //= 10
    return True
"""
        self.assertEqual(self.assert_path(code, "unique(1231)")["finalOutput"], "False")
        self.assertEqual(self.assert_path(code, "unique(1234)")["finalOutput"], "True")

    def test_pair_executes_both_implementations(self):
        result = trace_pair("def f(x):\n    return x + 1", "def f(x):\n    return x + 2", "f(2)")
        self.assertEqual(result["source"], "instrumented-python")
        self.assertEqual(result["student"]["finalOutput"], "3")
        self.assertEqual(result["llm"]["finalOutput"], "4")

    def test_syntax_runtime_and_nonliteral_input_fail_explicitly(self):
        for code, call in [
            ("def f(x)\n    return x", "f(1)"),
            ("def f(x):\n    return 1 / x", "f(0)"),
            ("def f(x):\n    return x", "f(open('file'))"),
            ("def f(x):\n    return x", "other(1)"),
        ]:
            with self.subTest(code=code, call=call), self.assertRaises(PythonTraceError):
                trace_python(code, call)

    def test_bounded_trace_and_variable_snapshots(self):
        code = "def f(n):\n    values = []\n    for i in range(n):\n        values.append(i)\n    return len(values)"
        trace = trace_python(code, "f(200)")
        self.assertEqual(len(trace["steps"]), 120)
        self.assertTrue(trace["truncated"])
        self.assertEqual(trace["finalOutput"], "200")
        self.assertEqual(trace["steps"][1]["variables"]["values"], "[]")


if __name__ == "__main__":
    unittest.main()
