import hashlib
import unittest
from unittest.mock import Mock
from query_service import serve_query


class QueryServiceTests(unittest.TestCase):
    def setUp(self):
        self.body = {"ticket": "f1749754-85ad-4d73-bf0c-cf5042a0d443", "query": "solar efficiency"}
        self.client = Mock()
        self.client.json.return_value = {"sha256": hashlib.sha256(self.body["query"].encode()).hexdigest()}
        self.embed = Mock(return_value=[[1.0] * 768])

    def test_redeems_before_paid_call(self):
        def embed(*args, **kwargs):
            self.client.json.assert_called_once()
            self.assertEqual(kwargs["task_type"], "RETRIEVAL_QUERY")
            return [[1.0] * 768]
        self.assertEqual(len(serve_query(self.body, self.client, "key", embed)["values"]), 768)

    def test_ticket_denial_never_calls_provider(self):
        self.client.json.side_effect = RuntimeError("used ticket")
        with self.assertRaises(RuntimeError):
            serve_query(self.body, self.client, "key", self.embed)
        self.embed.assert_not_called()

    def test_changed_query_never_calls_provider(self):
        self.client.json.return_value = {"sha256": "0" * 64}
        with self.assertRaises(ValueError):
            serve_query(self.body, self.client, "key", self.embed)
        self.embed.assert_not_called()

    def test_unconfigured_does_not_consume_ticket(self):
        with self.assertRaises(RuntimeError):
            serve_query(self.body, self.client, None, self.embed)
        self.client.json.assert_not_called()

    def test_rejects_arbitrary_provider_parameters(self):
        with self.assertRaises(ValueError):
            serve_query({**self.body, "model": "other"}, self.client, "key", self.embed)
        self.client.json.assert_not_called()
