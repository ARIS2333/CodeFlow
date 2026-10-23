import unittest
from unittest.mock import patch

from usage_tracking import usage_recorder


class UsageTrackingTests(unittest.TestCase):
    def test_participant_usage_is_linked_to_question_and_format(self):
        body = {
            "modelConfig": {
                "registrationId": "85d87357-c214-42e7-a4ed-741e374063a6",
                "usageContext": {"questionId": "q2", "feedbackFormat": "textual"},
            }
        }
        with patch("usage_tracking.record_llm_usage") as save:
            recorder = usage_recorder(
                body,
                provider="openai",
                operation="textual feedback",
                request_id="request-1",
            )
            self.assertIsNotNone(recorder)
            recorder("gpt-6.1-sol", {"input_tokens": 10, "output_tokens": 2})

        self.assertEqual(save.call_args.kwargs["question_id"], "q2")
        self.assertEqual(save.call_args.kwargs["feedback_format"], "textual")
        self.assertEqual(save.call_args.kwargs["operation"], "textual feedback")

    def test_byok_and_research_requests_are_not_attached_to_a_student(self):
        self.assertIsNone(usage_recorder(
            {"modelConfig": {"provider": "openai", "apiKey": "secret"}},
            provider="openai",
            operation="feedback",
            request_id="request-2",
        ))


if __name__ == "__main__":
    unittest.main()
