import re
import unittest

from participants import group_for_participant, participant_assignments


class ParticipantAssignmentsTests(unittest.TestCase):
    def test_registry_contains_both_sequences_and_the_special_test_account(self):
        assignments = participant_assignments()
        self.assertEqual(len(assignments), 301)
        self.assertEqual(list(assignments.values()).count("A"), 151)
        self.assertEqual(list(assignments.values()).count("B"), 150)
        self.assertEqual(assignments["S1_000_ABCDE"], "A")
        self.assertTrue(all(
            participant_id.startswith("S1_")
            for participant_id, group in assignments.items()
            if group == "A"
        ))
        self.assertTrue(all(
            participant_id.startswith("S2_")
            for participant_id, group in assignments.items()
            if group == "B"
        ))
        self.assertTrue(all(
            re.fullmatch(r"S[12]_\d{3}_[A-HJ-NP-Z2-9]{5}", participant_id)
            for participant_id in assignments
        ))
        suffixes = [participant_id.rsplit("_", 1)[1] for participant_id in assignments]
        self.assertEqual(len(suffixes), len(set(suffixes)))

        for prefix, group in (("S1", "A"), ("S2", "B")):
            participant_numbers = {
                int(participant_id.split("_")[1])
                for participant_id, assigned_group in assignments.items()
                if assigned_group == group and participant_id != "S1_000_ABCDE"
            }
            self.assertEqual(participant_numbers, set(range(1, 151)), prefix)

    def test_ids_are_normalized_and_unknown_ids_are_rejected(self):
        self.assertEqual(
            group_for_participant(" s2_001_2wtlm "),
            ("S2_001_2WTLM", "B"),
        )
        self.assertIsNone(group_for_participant("S1_999_BADID"))
        self.assertIsNone(group_for_participant(None))


if __name__ == "__main__":
    unittest.main()
