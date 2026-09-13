import importlib.util
import pathlib
import unittest


module_path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "python_rpc"
    / "tracker_validation.py"
)
spec = importlib.util.spec_from_file_location("tracker_validation", module_path)
tracker_validation = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(tracker_validation)


class TrackerValidationTests(unittest.TestCase):
    def test_accepts_supported_protocols_and_deduplicates(self):
        trackers = tracker_validation.normalize_trackers(
            [
                " udp://tracker.example:6969/announce ",
                "https://tracker.example/announce?passkey=abc",
                "udp://tracker.example:6969/announce",
                "wss://tracker.example/announce",
            ]
        )

        self.assertEqual(
            trackers,
            [
                "udp://tracker.example:6969/announce",
                "https://tracker.example/announce?passkey=abc",
                "wss://tracker.example/announce",
            ],
        )

    def test_rejects_invalid_protocols_hosts_ports_fragments_and_whitespace(self):
        invalid_values = [
            "file:///etc/passwd",
            "http:///announce",
            "udp://",
            "https://tracker.example:70000/announce",
            "https://tracker.example/a b",
            "https://tracker.example/announce#fragment",
        ]

        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "invalid_trackers"):
                    tracker_validation.normalize_trackers([value])

    def test_rejects_non_list_and_oversized_lists(self):
        with self.assertRaisesRegex(ValueError, "invalid_trackers"):
            tracker_validation.normalize_trackers("udp://tracker.example")

        with self.assertRaisesRegex(ValueError, "invalid_trackers"):
            tracker_validation.normalize_trackers(
                [
                    "udp://tracker-{0}.example/announce".format(index)
                    for index in range(tracker_validation.MAX_GLOBAL_TRACKERS + 1)
                ]
            )

    def test_none_is_backward_compatible(self):
        self.assertEqual(tracker_validation.normalize_trackers(None), [])


if __name__ == "__main__":
    unittest.main()
