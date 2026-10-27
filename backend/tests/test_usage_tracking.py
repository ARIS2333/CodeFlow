import unittest
from decimal import Decimal
from uuid import UUID
from unittest.mock import patch

from database import participant_usage_summary
from usage_tracking import usage_recorder


class UsageTrackingTests(unittest.TestCase):
    def test_allowance_blocks_at_one_dollar_and_preserves_recorded_spend(self):
        for spent, exhausted, remaining in [
            ('0.50', False, 0.50), ('0.99', False, 0.01),
            ('1.00', True, 0.0), ('1.05', True, 0.0),
        ]:
            with self.subTest(spent=spent), patch('database.initialize_database'), patch('database.connect') as connect:
                cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
                cursor.fetchone.return_value = (Decimal(spent),)
                summary = participant_usage_summary(UUID('85d87357-c214-42e7-a4ed-741e374063a6'))
                self.assertEqual(summary['limitUsd'], 1.0)
                self.assertEqual(summary['spentUsd'], float(spent))
                self.assertEqual(summary['exhausted'], exhausted)
                self.assertEqual(summary['remainingUsd'], remaining)

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
