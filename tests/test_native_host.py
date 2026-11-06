import importlib.util
import json
import signal
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "native_host", Path(__file__).resolve().parents[1] / "native-host/native_host.py"
)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
URL = "https://example.com/video"


class NativeHostTests(unittest.TestCase):
    def setUp(self):
        self.messages = []
        self.sender = patch.object(host, "send_message", side_effect=self.messages.append)
        self.sender.start()
        self.addCleanup(self.sender.stop)

    def test_reads_audio_and_merge_errors_after_video_reaches_100(self):
        lines = iter([
            "[download] 100% of 1MiB\n",
            "[download] Destination: audio.webm\n",
            "[download] 50.0% of 1MiB at 1MiB/s ETA 00:01\n",
            "[Merger] Merging formats\n",
            "ERROR: Postprocessing: Conversion failed!\n",
        ])
        proc = Mock(stdout=lines)

        def wait():
            self.assertEqual(list(lines), [], "Must drain the pipe before waiting")
            return 1

        proc.wait.side_effect = wait
        with patch.object(host, "_ytdlp_command", return_value=["yt-dlp"]), \
             patch.object(host.subprocess, "Popen", return_value=proc):
            rc, error = host._run_one_download("bv*+ba/b", "output", URL)
        self.assertEqual(rc, 1)
        self.assertIn("Conversion failed", error)
        self.assertEqual([m["percent"] for m in self.messages if m["type"] == "progress"], [100, 50])
        self.assertTrue(any(m["type"] == "status" and "Merging" in m["text"] for m in self.messages))

    def test_enables_available_node_and_prefers_updated_user_binary(self):
        user_bin = str(Path.home() / ".local/bin/yt-dlp")
        binaries = {user_bin: user_bin, "yt-dlp": "/usr/bin/yt-dlp", "node": "/usr/bin/node"}
        with patch.object(host.shutil, "which", side_effect=binaries.get):
            self.assertEqual(host._ytdlp_command(), [user_bin, "--js-runtimes", "node:/usr/bin/node"])

    def test_format_lookup_is_bounded_and_only_requests_selected_video(self):
        succeeded = subprocess.CompletedProcess([], 0, json.dumps({"title": "Video", "formats": []}), "")
        with patch.object(host, "_ytdlp_command", return_value=["yt-dlp"]), \
             patch.object(host.subprocess, "run", return_value=succeeded) as run:
            host.handle_list_formats(URL)
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        self.assertIn("--no-playlist", run.call_args.args[0])
        self.assertIn("--socket-timeout", run.call_args.args[0])
        self.assertEqual(self.messages[-1]["type"], "formats")

    def test_format_lookup_failure_never_waits_for_update(self):
        failed = subprocess.CompletedProcess([], 1, "", "ERROR: HTTP Error 403: Forbidden")
        with patch.object(host, "_ytdlp_command", return_value=["yt-dlp"]), \
             patch.object(host.subprocess, "run", return_value=failed) as run, \
             patch.object(host, "update_ytdlp") as update:
            host.handle_list_formats(URL)
        run.assert_called_once()
        update.assert_not_called()
        self.assertEqual(self.messages[-1]["type"], "error")
        self.assertIn("HTTP Error 403", self.messages[-1]["message"])

    def test_format_lookup_timeout_is_reported(self):
        with patch.object(host, "_ytdlp_command", return_value=["yt-dlp"]), \
             patch.object(host.subprocess, "run", side_effect=subprocess.TimeoutExpired("yt-dlp", 30)):
            host.handle_list_formats(URL)
        self.assertEqual(self.messages[-1]["type"], "error")
        self.assertIn("30 seconds", self.messages[-1]["message"])

    def test_refresh_installs_recommended_dependencies_and_respects_cooldown(self):
        with patch.object(host, "_update_cooldown_ok", return_value=False), \
             patch.object(host.subprocess, "run") as run:
            self.assertFalse(host.update_ytdlp())
            run.assert_not_called()
        with patch.object(host, "_update_cooldown_ok", return_value=True), \
             patch.object(host, "_mark_update_attempt"), \
             patch.object(host.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            self.assertTrue(host.update_ytdlp())
            self.assertIn("yt-dlp[default]", run.call_args.args[0])

    def test_download_retries_once_but_never_retries_cancellation(self):
        for result, expected, refreshes in [
            ([(1, "ERROR: HTTP 403"), (0, None)], "done", 1),
            ([(1, "ERROR: HTTP 403"), (1, "ERROR: still forbidden")], "error", 1),
            ([(-signal.SIGINT, None)], "canceled", 0),
        ]:
            with self.subTest(expected=expected):
                self.messages.clear()
                with patch.object(host.os, "makedirs"), \
                     patch.object(host, "_run_one_download", side_effect=result) as run, \
                     patch.object(host, "update_ytdlp", return_value=True) as update, \
                     patch.object(host, "_current_ytdlp_version", return_value="test"):
                    host._do_download(URL, "best")
                self.assertEqual(run.call_count, len(result))
                self.assertEqual(update.call_count, refreshes)
                self.assertEqual(self.messages[-1]["type"], expected)
                if expected == "error":
                    self.assertIn("still forbidden", self.messages[-1]["message"])

    def test_worker_exception_is_reported_after_started(self):
        with patch.object(host, "_do_download", side_effect=PermissionError("Cannot write download")), \
             patch.object(host.threading, "Thread") as thread:
            thread.return_value.start.side_effect = lambda: thread.call_args.kwargs["target"]()
            host.handle_download(URL, "best")
        self.assertEqual([m["type"] for m in self.messages], ["download_started", "error"])
        self.assertIn("Cannot write download", self.messages[-1]["message"])

    def test_invalid_url_never_starts_worker(self):
        with patch.object(host.threading, "Thread") as thread:
            host.handle_download("file:///etc/passwd", "best")
            thread.assert_not_called()
        self.assertEqual(self.messages[-1]["type"], "error")


if __name__ == "__main__":
    unittest.main()
