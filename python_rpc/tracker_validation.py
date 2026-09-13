import urllib.parse


VALID_TRACKER_PROTOCOLS = {"http", "https", "udp", "ws", "wss"}
MAX_GLOBAL_TRACKERS = 128
MAX_TRACKER_URL_LENGTH = 2_048
MAX_TRACKER_LIST_TEXT_LENGTH = 65_536


def _normalize_tracker_url(value):
    if not isinstance(value, str):
        raise ValueError("invalid_trackers")

    tracker = value.strip()
    if not tracker or len(tracker) > MAX_TRACKER_URL_LENGTH:
        raise ValueError("invalid_trackers")

    if any(ord(char) <= 0x20 or ord(char) == 0x7F for char in tracker):
        raise ValueError("invalid_trackers")

    if ":///" in tracker:
        raise ValueError("invalid_trackers")

    try:
        parsed = urllib.parse.urlsplit(tracker)
        if (
            parsed.scheme.lower() not in VALID_TRACKER_PROTOCOLS
            or not parsed.hostname
            or parsed.fragment
        ):
            raise ValueError("invalid_trackers")

        # urllib validates malformed and out-of-range ports lazily.
        parsed.port
    except (TypeError, ValueError, UnicodeError) as error:
        raise ValueError("invalid_trackers") from error

    return tracker


def normalize_trackers(trackers):
    if trackers is None:
        return []

    if not isinstance(trackers, list) or len(trackers) > MAX_GLOBAL_TRACKERS:
        raise ValueError("invalid_trackers")

    normalized = []
    seen = set()
    total_length = 0

    for value in trackers:
        tracker = _normalize_tracker_url(value)
        total_length += len(tracker)
        if total_length > MAX_TRACKER_LIST_TEXT_LENGTH:
            raise ValueError("invalid_trackers")

        if tracker in seen:
            continue

        seen.add(tracker)
        normalized.append(tracker)

    return normalized
