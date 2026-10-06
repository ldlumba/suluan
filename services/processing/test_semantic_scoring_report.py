import unittest

from semantic_scoring_report import evaluate


class SemanticScoringReportTests(unittest.TestCase):
    def test_report_measures_positive_rank_and_negative_abstention(self):
        queries = [
            {"id": "p", "kind": "positive", "expectedTitle": "Target"},
            {"id": "n", "kind": "clean_negative"},
        ]
        artifact = {
            "vectors": [
                {
                    "id": "p",
                    "chunkDistances": {"a": [0.1, 0.2], "b": [0.4, 0.4]},
                    "rankedItems": [{"id": "a", "title": "Target"}],
                },
                {
                    "id": "n",
                    "chunkDistances": {"a": [0.5, 0.6]},
                    "rankedItems": [{"id": "a", "title": "Target"}],
                },
            ]
        }
        report = evaluate(
            queries,
            artifact,
            strategy="top_k_mean",
            max_score=0.3,
            min_margin=None,
        )
        self.assertEqual(report["positiveHitAt1"], 1)
        self.assertEqual(report["negativeAbstention"], 1)


if __name__ == "__main__":
    unittest.main()
