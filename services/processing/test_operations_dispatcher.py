import unittest

from operations_dispatcher import dispatch


class FakeClient:
    def __init__(self):
        self.calls = []

    def json(self, path, body):
        self.calls.append((path, body))
        if path.endswith("/redeem"):
            return {"operationId": "run-1", "action": "EXTRACTION"}
        return {"ok": True}


class OperationsDispatcherTests(unittest.TestCase):
    def test_redeems_before_launch_and_records_success(self):
        client = FakeClient()
        launched = []

        def launch(action, **kwargs):
            launched.append((action, kwargs))
            return "operations/cloud-run-1"

        result = dispatch(
            "ticket-1",
            client,
            project="project",
            location="region",
            jobs={"EXTRACTION": "processing"},
            launch=launch,
        )
        self.assertEqual(result["executionName"], "operations/cloud-run-1")
        self.assertEqual(client.calls[0][0], "/api/internal/repository-operations/redeem")
        self.assertEqual(client.calls[-1][1]["status"], "LAUNCHED")
        self.assertEqual(launched[0][0], "EXTRACTION")

    def test_records_failure_without_retrying(self):
        client = FakeClient()

        def fail(*args, **kwargs):
            raise RuntimeError("provider detail must not escape")

        with self.assertRaises(RuntimeError):
            dispatch(
                "ticket-1",
                client,
                project="project",
                location="region",
                jobs={"EXTRACTION": "processing"},
                launch=fail,
            )
        self.assertEqual(client.calls[-1][1]["status"], "FAILED")
        self.assertEqual(client.calls[-1][1]["errorCode"], "job_launch_failed")


if __name__ == "__main__":
    unittest.main()
