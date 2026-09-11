"""Capture the saved ryunenbb fixture at an exact mobile layout viewport."""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.request

import websocket


EDGE = pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


class Cdp:
    def __init__(self, socket_url: str):
        self.socket = websocket.create_connection(socket_url, timeout=10, origin="http://localhost")
        self.message_id = 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self.message_id += 1
        current = self.message_id
        self.socket.send(json.dumps({"id": current, "method": method, "params": params or {}}))
        while True:
            response = json.loads(self.socket.recv())
            if response.get("id") == current:
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response.get("result", {})

    def close(self) -> None:
        self.socket.close()


def wait_json(url: str, timeout: float = 10) -> list[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.load(response)
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(url)


def capture(width: int, height: int, output: pathlib.Path, page_url: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="shogi-review-cdp-") as profile:
        process = subprocess.Popen(
            [
                str(EDGE), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--remote-debugging-port=9223", "--remote-allow-origins=*",
                f"--user-data-dir={profile}", "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cdp = None
        try:
            targets = wait_json("http://127.0.0.1:9223/json")
            page = next(target for target in targets if target.get("type") == "page")
            cdp = Cdp(page["webSocketDebuggerUrl"])
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": width, "height": height, "deviceScaleFactor": 1, "mobile": True,
                "screenWidth": width, "screenHeight": height,
            })
            cdp.call("Page.navigate", {"url": page_url})
            deadline = time.time() + 15
            while time.time() < deadline:
                result = cdp.call("Runtime.evaluate", {
                    "expression": "document.readyState==='complete'&&document.querySelector('#counter')?.textContent.startsWith('80/')",
                    "returnByValue": True,
                })
                if result.get("result", {}).get("value") is True:
                    break
                time.sleep(0.1)
            else:
                raise TimeoutError("fixture did not reach ply 80")

            metrics_expression = """
            (() => {
              const rect = selector => { const e=document.querySelector(selector); if(!e)return null; const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
              return {
                innerWidth, innerHeight, devicePixelRatio,
                review: rect('#reviewView'), board: rect('.boardShell'), controls: rect('.controls'),
                evaluation: rect('.evalWrap'), issue: rect('#review'), learning: rect('#nextGameLearning'), navigation: rect('.tabs'),
                contentBottom: Math.max(...Array.from(document.querySelector('#reviewView').children).map(e => e.getBoundingClientRect().bottom)),
                contentHeight: document.querySelector('#reviewView').scrollHeight,
                clientHeight: document.querySelector('#reviewView').clientHeight,
                initialScrollTop: document.querySelector('#reviewView').scrollTop,
                summaryOpen: Boolean(document.querySelector('#gameSummary details')?.open),
                learningOpen: Boolean(document.querySelector('#nextGameLearning details')?.open),
                pvOpen: Boolean(document.querySelector('.pvDetails')?.open),
                reasonText: document.querySelector('#review')?.innerText,
              };
            })()
            """
            metrics = cdp.call("Runtime.evaluate", {"expression": metrics_expression, "returnByValue": True})["result"]["value"]
            shot = cdp.call("Page.captureScreenshot", {"format": "png", "fromSurface": True, "captureBeyondViewport": False})
            output.write_bytes(base64.b64decode(shot["data"]))
            return metrics
        finally:
            if cdp:
                cdp.close()
            process.terminate()
            process.wait(timeout=10)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8765/?game=20260911_ryunenbb&ply=80")
    parser.add_argument("--output-dir", type=pathlib.Path, default=pathlib.Path("docs/reports"))
    args = parser.parse_args()
    all_metrics = {}
    for width in (390, 375):
        output = args.output_dir / f"SHOGI_REASON-EXPLANATION_ONESCREEN_{width}x844.png"
        all_metrics[str(width)] = capture(width, 844, output, args.url)
    print(json.dumps(all_metrics, ensure_ascii=True, indent=2))
    for width, metrics in all_metrics.items():
        assert metrics["innerWidth"] == int(width)
        assert metrics["innerHeight"] == 844
        assert metrics["initialScrollTop"] == 0
        assert not metrics["summaryOpen"] and not metrics["learningOpen"] and not metrics["pvOpen"]
        assert metrics["contentHeight"] <= metrics["clientHeight"], metrics
        assert metrics["contentBottom"] <= metrics["review"]["bottom"], metrics
        assert metrics["issue"]["bottom"] <= metrics["navigation"]["top"], metrics


if __name__ == "__main__":
    main()
