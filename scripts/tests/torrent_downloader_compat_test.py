import importlib.util
import pathlib
import sys
import types
import unittest


class _Params:
    def __init__(self):
        self.flags = 0b0010
        self.trackers = ["udp://magnet.example:80/announce"]
        self.tracker_tiers = [3]
        self.save_path = ""


class _TorrentFlags:
    auto_managed = 0b0001
    paused = 0b0010
    default_dont_download = 0b0100
    upload_mode = 0b1000


fake_libtorrent = types.SimpleNamespace(
    torrent_flags=_TorrentFlags,
    parse_magnet_uri=lambda _magnet: _Params(),
    announce_entry=lambda url: types.SimpleNamespace(url=url),
    session=types.SimpleNamespace(delete_partfile=1),
)
sys.modules["libtorrent"] = fake_libtorrent

module_path = (
    pathlib.Path(__file__).resolve().parents[2]
    / "python_rpc"
    / "torrent_downloader.py"
)
spec = importlib.util.spec_from_file_location("torrent_downloader", module_path)
torrent_downloader = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(torrent_downloader)
TorrentDownloader = torrent_downloader.TorrentDownloader


class _Session:
    def __init__(self):
        self.settings = []

    def apply_settings(self, settings):
        self.settings.append(settings)


class TorrentDownloaderCompatTests(unittest.TestCase):
    def test_uses_libtorrent_21_settings_api(self):
        session = _Session()
        downloader = TorrentDownloader(session)

        downloader.set_download_limit(1234)

        self.assertEqual(session.settings, [{"download_rate_limit": 1234}])

    def test_preserves_magnet_flags_and_tracker_tiers(self):
        downloader = TorrentDownloader(_Session())

        params = downloader._build_add_torrent_params(
            "magnet:?xt=urn:btih:abc",
            "C:/Downloads",
            0b1000,
            ["https://user.example/announce"],
        )

        self.assertEqual(params.flags, 0b1010)
        self.assertEqual(params.save_path, "C:/Downloads")
        self.assertEqual(params.trackers[0:2], [
            "udp://magnet.example:80/announce",
            "https://user.example/announce",
        ])
        self.assertEqual(params.tracker_tiers[0:2], [3, 0])
        self.assertTrue(
            all(tier == 4 for tier in params.tracker_tiers[2:]),
            params.tracker_tiers,
        )

    def test_uses_new_torrent_file_accessor_with_legacy_fallback(self):
        downloader = TorrentDownloader(_Session())
        new_info = object()
        downloader.torrent_handle = types.SimpleNamespace(
            is_valid=lambda: True,
            torrent_file=lambda: new_info,
        )
        self.assertIs(downloader._get_torrent_info(), new_info)

        legacy_info = object()
        downloader.torrent_handle = types.SimpleNamespace(
            is_valid=lambda: True,
            get_torrent_info=lambda: legacy_info,
        )
        self.assertIs(downloader._get_torrent_info(), legacy_info)


if __name__ == "__main__":
    unittest.main()
