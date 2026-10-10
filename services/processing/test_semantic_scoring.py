import unittest

from semantic_scoring import (
    abstention_reason,
    log_length_penalized_min,
    proportional_top_k_mean,
    reciprocal_rank_fusion,
    score_records,
    top_k_mean,
)


class SemanticScoringTests(unittest.TestCase):
    def test_top_k_mean_requires_multiple_good_chunks(self):
        self.assertAlmostEqual(top_k_mean([0.1, 0.9, 0.9], 3), 0.6333333333)
        self.assertAlmostEqual(top_k_mean([0.1, 0.9, 0.9], 2), 0.5)

    def test_proportional_strategy_is_bounded_and_length_explicit(self):
        self.assertAlmostEqual(proportional_top_k_mean([0.1, 0.2], 0.1, 3), 0.15)
        self.assertAlmostEqual(
            proportional_top_k_mean([0.1, 0.2, 0.3, 0.4, 0.5], 0.4, 3), 0.2
        )

    def test_length_penalty_is_monotonic(self):
        self.assertGreater(
            log_length_penalized_min([0.1] * 20),
            log_length_penalized_min([0.1] * 2),
        )

    def test_rank_is_stable_for_equal_scores(self):
        ranked = score_records(
            {"b": [0.2, 0.2], "a": [0.2, 0.2]}, strategy="top_k_mean", top_k=2
        )
        self.assertEqual([item.record_id for item in ranked], ["a", "b"])

    def test_rrf_rewards_records_present_in_both_rankings(self):
        ranked = reciprocal_rank_fusion(
            [["semantic-only", "shared"], ["shared", "keyword-only"]]
        )
        self.assertEqual(ranked[0], "shared")
        self.assertEqual(set(ranked), {"semantic-only", "shared", "keyword-only"})

    def test_rrf_rejects_invalid_constant(self):
        with self.assertRaises(ValueError):
            reciprocal_rank_fusion([["a"]], constant=0)

    def test_abstention_never_returns_nearest_for_a_failed_floor(self):
        ranked = score_records({"paper": [0.42, 0.45]}, strategy="top_k_mean")
        self.assertEqual(abstention_reason(ranked, max_score=0.4), "score_floor")
        self.assertIsNone(abstention_reason(ranked, max_score=0.5))

    def test_abstention_can_require_a_margin(self):
        ranked = score_records(
            {"a": [0.20, 0.20], "b": [0.21, 0.21]}, strategy="top_k_mean", top_k=2
        )
        self.assertEqual(
            abstention_reason(ranked, max_score=0.5, min_margin=0.02),
            "insufficient_margin",
        )

    def test_invalid_distances_are_rejected(self):
        with self.assertRaises(ValueError):
            score_records({"paper": []})
        with self.assertRaises(ValueError):
            score_records({"paper": [float("nan")]})


if __name__ == "__main__":
    unittest.main()
