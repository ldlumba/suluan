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

    def test_report_supports_multi_expected_titles(self):
        queries = [
            {
                "id": "m",
                "kind": "multi_positive",
                "expectedTitles": ["First", "Second"],
            }
        ]
        artifact = {
            "vectors": [
                {
                    "id": "m",
                    "chunkDistances": {"a": [0.1], "b": [0.2]},
                    "rankedItems": [
                        {"id": "a", "title": "First"},
                        {"id": "b", "title": "Second"},
                    ],
                }
            ]
        }
        report = evaluate(
            queries,
            artifact,
            strategy="min",
            max_score=0.3,
            min_margin=None,
        )
        self.assertEqual(report["rows"][0]["expectedRanks"], [1, 2])
        self.assertTrue(report["rows"][0]["expectedAllFound"])
        self.assertEqual(report["byKind"]["multi_positive"]["allExpectedFound"], 1)

    def test_report_accepts_any_record_when_titles_are_not_unique(self):
        queries = [{"id": "p", "kind": "positive", "expectedTitle": "Same title"}]
        artifact = {
            "vectors": [
                {
                    "id": "p",
                    "chunkDistances": {"first": [0.1], "second": [0.2]},
                    "rankedItems": [
                        {"id": "first", "title": "Same title"},
                        {"id": "second", "title": "Same title"},
                    ],
                }
            ]
        }
        report = evaluate(
            queries,
            artifact,
            strategy="min",
            max_score=0.3,
            min_margin=None,
        )
        self.assertEqual(report["rows"][0]["expectedRank"], 1)


if __name__ == "__main__":
    unittest.main()
