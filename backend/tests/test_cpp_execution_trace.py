import shutil
import unittest

from cpp_execution_trace import CppTraceError, trace_cpp


@unittest.skipUnless(shutil.which("g++"), "g++ is required for native trace tests")
class CppExecutionTraceTests(unittest.TestCase):
    def test_unique_number_records_real_loop_state_and_result(self):
        traced = trace_cpp(
            """#include <set>
bool isNumUnique(int n) {
    std::set<int> seen;
    while (n != 0) {
        int digit = n % 10;
        if (seen.count(digit)) return false;
        seen.insert(digit);
        n /= 10;
    }
    return true;
}
""",
            "isNumUnique(1231)",
        )

        self.assertEqual(traced["finalOutput"], "false")
        self.assertGreater(len(traced["steps"]), 10)
        self.assertEqual(traced["steps"][0]["nodeId"], "1")
        self.assertTrue(any(
            step["variables"].get("seen") == "{1, 2, 3}"
            for step in traced["steps"]
        ))

    def test_each_fixed_study_signature_gets_a_real_harness(self):
        cases = (
            (
                """#include <vector>
#include <unordered_map>
#include <utility>
using namespace std;
pair<int,int> two_sum(vector<int>& a, int target) {
    unordered_map<int,int> seen;
    for (int j = 0; j < (int)a.size(); ++j) {
        int need = target - a[j];
        if (seen.count(need)) return {seen[need], j};
        seen[a[j]] = j;
    }
    return {-1, -1};
}
""",
                "two_sum({2, 7, 11, 15}, 18)",
                "{1, 2}",
            ),
            (
                """#include <string>
#include <map>
using namespace std;
string findTheDigits(string x, string y) {
    map<char,int> count;
    for (char c : y) count[c]++;
    for (char c : x) count[c]--;
    string result;
    for (auto entry : count)
        for (int i = 0; i < entry.second; ++i) result += entry.first;
    return result;
}
""",
                'findTheDigits("12", "2210")',
                '"02"',
            ),
            (
                """#include <vector>
#include <unordered_map>
#include <climits>
using namespace std;
int findMode(vector<int>& nums) {
    unordered_map<int,int> frequency;
    for (int value : nums) frequency[value]++;
    int mode = INT_MAX, best = 0;
    for (auto entry : frequency) {
        if (entry.second > best ||
            (entry.second == best && entry.first < mode)) {
            best = entry.second;
            mode = entry.first;
        }
    }
    return mode;
}
""",
                "findMode({6, 4, 9, 6, 6, 4, 9, 4, 9})",
                "4",
            ),
        )

        for source, call, expected in cases:
            with self.subTest(call=call):
                traced = trace_cpp(source, call)
                self.assertEqual(traced["finalOutput"], expected)
                self.assertFalse(traced["truncated"])
                self.assertGreater(len(traced["steps"]), 1)

    def test_input_is_parsed_as_the_expected_function_call(self):
        with self.assertRaisesRegex(CppTraceError, "Use an input such as"):
            trace_cpp(
                "bool isNumUnique(int n) { return true; }",
                "system(\"whoami\")",
            )


if __name__ == "__main__":
    unittest.main()
