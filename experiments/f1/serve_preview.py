"""Serve the fixed F1 sample and its indoor theme on localhost."""

import argparse
import json
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from prepare_preview import MAP_ZIP, THEME_ID, prepare_map_assets
from read_sample import read_f1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sdk_zip", type=Path, help="Official v3.2.0 SDK Lib ZIP")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    app_name = os.environ.get("FENGMAP_APP_NAME")
    key = os.environ.get("FENGMAP_KEY")
    if not app_name or not key:
        parser.error("Set FENGMAP_APP_NAME and FENGMAP_KEY for your FengMap SDK app")

    here = Path(__file__).resolve().parent
    sample = read_f1(MAP_ZIP)

    with TemporaryDirectory(prefix="scenebridge-preview-") as directory:
        root = Path(directory)
        shutil.copyfile(here / "preview.html", root / "index.html")
        prepare_map_assets(root)
        sdk_folder = "JavaScript_SDK_v3.2.0_Lib(Es5)"
        with ZipFile(args.sdk_zip) as archive:
            archive.extractall(root / "sdk", members=[
                f"{sdk_folder}/{name}" for name in (
                    "fengmap.map.min.js", "draco_decoder.js",
                    "draco_decoder.wasm", "draco_wasm_wrapper.js",
                )
            ])

        config = {"appName": app_name, "key": key, "themeID": THEME_ID}
        (root / "config.json").write_text(json.dumps(config), encoding="utf-8")
        (root / "f1.json").write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")
        handler = partial(SimpleHTTPRequestHandler, directory=directory)
        with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
            print(f"F1 preview: http://127.0.0.1:{server.server_port}/", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
