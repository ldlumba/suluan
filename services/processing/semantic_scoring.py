"""Pure semantic ranking candidates and abstention diagnostics.

This module has no provider, database, or document-text dependencies. It is
used to compare scoring hypotheses against exported per-chunk distances before
a policy is promoted to the Worker.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence


def _distances(values: Iterable[float]) -> list[float]:
    result = [float(value) for value in values]
    if not result:
        raise ValueError("a record must have at least one chunk distance")
    if any(not math.isfinite(value) or value < 0 or value > 2 for value in result):
        raise ValueError("chunk distances must be finite cosine distances in [0, 2]")
    return sorted(result)


def min_distance(values: Iterable[float]) -> float:
    """Current control: the closest chunk distance."""
    return _distances(values)[0]


def top_k_mean(values: Iterable[float], k: int = 3) -> float:
    """Mean of the closest k chunks, or all chunks when fewer than k exist."""
    if k < 1:
        raise ValueError("k must be positive")
    distances = _distances(values)
    return statistics.mean(distances[:k])


def proportional_top_k_mean(
    values: Iterable[float], proportion: float = 0.10, minimum_k: int = 3
) -> float:
    """Top-k mean with k increasing with document length."""
    if not 0 < proportion <= 1:
        raise ValueError("proportion must be in (0, 1]")
    if minimum_k < 1:
        raise ValueError("minimum_k must be positive")
    distances = _distances(values)
    k = min(len(distances), max(minimum_k, math.ceil(len(distances) * proportion)))
    return statistics.mean(distances[:k])


def log_length_penalized_min(values: Iterable[float], penalty: float = 0.02) -> float:
    """Candidate control that penalizes the extreme-value opportunity."""
    if penalty < 0:
        raise ValueError("penalty must not be negative")
    distances = _distances(values)
    return distances[0] + penalty * math.log1p(len(distances))


@dataclass(frozen=True)
class ScoredRecord:
    record_id: str
    score: float
    chunk_count: int
    best_chunk_distance: float


def score_records(
    records: Mapping[str, Sequence[float]],
    strategy: str = "top_k_mean",
    *,
    top_k: int = 3,
    proportion: float = 0.10,
    penalty: float = 0.02,
) -> list[ScoredRecord]:
    """Score and stably rank records from paper-id to chunk distances."""
    scored: list[ScoredRecord] = []
    for record_id, values in records.items():
        distances = _distances(values)
        if strategy == "min":
            score = distances[0]
        elif strategy == "top_k_mean":
            score = top_k_mean(distances, top_k)
        elif strategy == "proportional_top_k_mean":
            score = proportional_top_k_mean(distances, proportion, top_k)
        elif strategy == "log_length_penalized_min":
            score = log_length_penalized_min(distances, penalty)
        else:
            raise ValueError(f"unknown scoring strategy: {strategy}")
        scored.append(ScoredRecord(record_id, score, len(distances), distances[0]))
    return sorted(scored, key=lambda item: (item.score, item.record_id))


def abstention_reason(
    ranked: Sequence[ScoredRecord],
    *,
    max_score: float,
    min_margin: float | None = None,
) -> str | None:
    """Return a stable reason when the ranked list should abstain.

    A non-None reason means the caller must return no semantic result rather
    than expose the nearest paper. This helper does not choose thresholds.
    """
    if max_score < 0 or max_score > 2:
        raise ValueError("max_score must be in [0, 2]")
    if min_margin is not None and min_margin < 0:
        raise ValueError("min_margin must not be negative")
    if not ranked:
        return "no_candidates"
    if ranked[0].score > max_score:
        return "score_floor"
    if min_margin is not None and len(ranked) > 1:
        if ranked[1].score - ranked[0].score < min_margin:
            return "insufficient_margin"
    return None
