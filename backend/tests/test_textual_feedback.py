import unittest

from textual_feedback import (
    TEXTUAL_FEEDBACK_PROMPT,
    TEXTUAL_RETRACE_PROMPT,
    render_textual_feedback_prompt,
)


class TextualFeedbackTests(unittest.TestCase):
    def test_researcher_prompt_is_rendered_without_rewriting_its_rules(self):
        rendered = render_textual_feedback_prompt(
            {"title": "Count values", "description": "Return the count."},
            "int count() { return 0; }",
        )
        self.assertEqual(
            rendered,
            TEXTUAL_FEEDBACK_PROMPT
            .replace("{{PROBLEM_DESCRIPTION}}", '{\n  "title": "Count values",\n  "description": "Return the count."\n}')
            .replace("{{STUDENT_SUBMISSION}}", "int count() { return 0; }")
            .replace("{{EXECUTION_INPUT}}", ""),
        )
        self.assertNotIn("{{PROBLEM_DESCRIPTION}}", rendered)
        self.assertNotIn("{{STUDENT_SUBMISSION}}", rendered)

    def test_student_selected_input_is_inserted_as_input_material(self):
        rendered = render_textual_feedback_prompt(
            {"title": "Count values"},
            "int count() { return 0; }",
            "count({2, 4, 5})",
        )
        self.assertIn(
            "<execution_input>\ncount({2, 4, 5})\n</execution_input>",
            rendered,
        )
        self.assertIn("use exactly that input", rendered)

    def test_retrace_keeps_prior_logic_as_fixed_input_material(self):
        rendered = render_textual_feedback_prompt(
            {"title": "Count values"},
            "int count() { return 0; }",
            "count({2, 4, 5})",
            {"student": "Student logic text.", "recommended": "Recommended logic text."},
        )
        self.assertIn("Student logic text.", rendered)
        self.assertIn("Recommended logic text.", rendered)
        self.assertIn("count({2, 4, 5})", rendered)
        self.assertTrue(rendered.startswith(TEXTUAL_RETRACE_PROMPT.split("{{PROBLEM_DESCRIPTION}}")[0]))

    def test_full_and_retrace_prompts_share_the_execution_contract(self):
        for prompt in (TEXTUAL_FEEDBACK_PROMPT, TEXTUAL_RETRACE_PROMPT):
            self.assertIn("same initial input", prompt)
            self.assertIn("**State:**", prompt)
            self.assertIn("own nested bullet line", prompt)
            self.assertIn("at most 120 numbered execution steps", prompt)
            self.assertIn("at most eight visible", prompt)
            self.assertIn("at most 120 characters", prompt)
            self.assertIn("separate `Termination:` or `Output:` summary", prompt)
            self.assertIn("Do not claim that you compiled, ran, tested, or verified", prompt)

    def test_full_prompt_preserves_structural_equivalence_without_diagnosing(self):
        self.assertIn("hierarchical natural-language outline", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("shortest valid input", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("complete normally", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("final externally observable results differ", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("identify or label the first divergence", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("interface may place the independent textual", TEXTUAL_FEEDBACK_PROMPT)
        self.assertIn("For steps that genuinely correspond", TEXTUAL_FEEDBACK_PROMPT)

    def test_retrace_follows_both_fixed_logic_outlines(self):
        self.assertIn("TRACE THE FIXED STUDENT LOGIC", TEXTUAL_RETRACE_PROMPT)
        self.assertIn("Follow that fixed outline faithfully", TEXTUAL_RETRACE_PROMPT)
        self.assertIn("TRACE THE FIXED RECOMMENDED LOGIC", TEXTUAL_RETRACE_PROMPT)


if __name__ == "__main__":
    unittest.main()
