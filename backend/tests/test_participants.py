import unittest

from participants import group_for_participant, participant_assignments


class ParticipantAssignmentsTests(unittest.TestCase):
    def test_fake_registry_contains_ten_balanced_assignments(self):
        assignments = participant_assignments()
        self.assertEqual(len(assignments), 10)
        self.assertEqual(list(assignments.values()).count("A"), 5)
        self.assertEqual(list(assignments.values()).count("B"), 5)

    def test_ids_are_normalized_and_unknown_ids_are_rejected(self):
        self.assertEqual(group_for_participant(" cf-p002 "), ("CF-P002", "B"))
        self.assertIsNone(group_for_participant("CF-P999"))
        self.assertIsNone(group_for_participant(None))


if __name__ == "__main__":
    unittest.main()
