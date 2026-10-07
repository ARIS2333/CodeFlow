"""Server-owned participant assignments for the human study."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


PARTICIPANTS_FILE = Path(__file__).with_name("participants.json")


def normalize_participant_id(value: str) -> str:
    return value.strip().upper()


@lru_cache(maxsize=1)
def participant_assignments() -> dict[str, str]:
    raw = json.loads(PARTICIPANTS_FILE.read_text(encoding="utf-8"))
    assignments: dict[str, str] = {}
    for entry in raw:
        participant_id = normalize_participant_id(entry["participantId"])
        group = entry["group"]
        if not participant_id or group not in {"A", "B"}:
            raise ValueError("Invalid participant assignment")
        if participant_id in assignments:
            raise ValueError("Duplicate participant ID")
        assignments[participant_id] = group
    return assignments


def group_for_participant(value: object) -> tuple[str, str] | None:
    if not isinstance(value, str):
        return None
    participant_id = normalize_participant_id(value)
    group = participant_assignments().get(participant_id)
    return (participant_id, group) if group else None
