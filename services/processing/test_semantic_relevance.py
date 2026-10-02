import unittest

from semantic_relevance import EvaluationError, run_evaluation


class SemanticRelevanceTests(unittest.TestCase):
    def test_evaluation_ranks_modes_and_discards_snippets(self):
        class Client:
            def json(self, path):
                if "/semantic?" in path:
                    return {
                        "semanticStatus": "ready",
                        "items": [
                            {"id": "a", "title": "Expected", "distance": 0.2, "snippet": "secret"},
                            {"id": "b", "title": "Other", "distance": 0.4, "snippet": "secret"},
                        ],
                    }
                return {"items": [{"id": "b", "title": "Other", "snippet": "secret"}]}

        probes = [
            {
                "id": "positive",
                "kind": "positive",
                "query": "meaningful query",
                "expectedTitle": "Expected",
                "expectedChunks": 4,
            },
            {"id": "negative", "kind": "clean_negative", "query": "unrelated"},
        ]
        waits = []
        checkpoints = []
        report = run_evaluation(
            Client(),
            probes,
            interval=3,
            sleep=waits.append,
            emit=lambda _: None,
            checkpoint=checkpoints.append,
        )
        positive = report["results"][0]
        self.assertEqual(positive["semanticRank"], 1)
        self.assertEqual(positive["keywordRank"], None)
        self.assertEqual(positive["hybridRank"], 2)
        self.assertNotIn("snippet", positive["semantic"][0])
        self.assertEqual(report["summary"]["semantic"]["hitAt1"], 1)
        self.assertTrue(report["complete"])
        self.assertEqual(checkpoints[0]["completedProbeCount"], 1)
        self.assertFalse(checkpoints[0]["complete"])
        self.assertEqual(waits, [3])

    def test_degraded_semantic_status_stops_without_retry(self):
        class Client:
            calls = 0

            def json(self, path):
                self.calls += 1
                return {"semanticStatus": "quota_exhausted", "items": []}

        client = Client()
        with self.assertRaisesRegex(EvaluationError, "quota_exhausted"):
            run_evaluation(
                client,
                [{"id": "q", "kind": "clean_negative", "query": "query"}],
                sleep=lambda _: None,
                emit=lambda _: None,
            )
        self.assertEqual(client.calls, 1)


if __name__ == "__main__":
    unittest.main()
