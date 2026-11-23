"""Prepare the local map and GLB assets for the Next.js F1 preview."""

import argparse
import json
import shutil
from pathlib import Path
from zipfile import ZipFile

from read_sample import read_f1


MAP_ID = "2067155016009707521"
THEME_ID = "2067158499815383041"
RESOURCES = Path(__file__).resolve().parents[2] / "fengMap"
MAP_ZIP = RESOURCES / "单独室内" / f"{MAP_ID}.zip"
THEME_ZIP = RESOURCES / "室内外一体化主题" / "2067162143855890434.zip"


def prepare_map_assets(root):
    with ZipFile(MAP_ZIP) as archive:
        archive.extractall(root / "map" / MAP_ID)
    with ZipFile(THEME_ZIP) as archive:
        indoor_files = [name for name in archive.namelist() if name.startswith(f"{THEME_ID}/")]
        archive.extractall(root / "theme", members=indoor_files)


def write_manifest(root, sample):
    from shapely.geometry import Polygon

    features = {(feature["kind"], feature["id"]): feature for feature in sample["features"]}
    anchors = []
    for kind, element_id, label in (
        ("extent", 1, "楼板孔洞"),
        ("model", 58, "贵宾室 N1-3"),
        ("model", 134, "会议室 N101"),
        ("model", 172, "男洗手间"),
    ):
        feature = features[kind, element_id]
        ring = feature["holes"][0] if kind == "extent" else feature["outer"]
        point = Polygon(ring).representative_point()
        anchors.append({
            "kind": kind,
            "sourceId": element_id,
            "label": label,
            "point": [point.x, point.y],
            "height": 0 if kind == "extent" else feature["sourceHeight"],
        })

    xs, ys = zip(*(point for feature in sample["features"] for point in feature["outer"]))
    manifest = {
        "mapId": sample["mapId"],
        "themeId": THEME_ID,
        "floorId": sample["floorId"],
        "origin": sample["mapCenter"],
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "anchors": anchors,
    }
    (root / "sample.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path, help="F1 GLB from build_glb.py")
    parser.add_argument("output", type=Path, help="Directory for SCENE_BRIDGE_F1_ASSETS")
    args = parser.parse_args()

    if not args.glb.is_file():
        parser.error(f"F1 GLB not found: {args.glb}")
    sample = read_f1(MAP_ZIP)
    prepare_map_assets(args.output)
    shutil.copyfile(args.glb, args.output / "F1.glb")
    write_manifest(args.output, sample)
    print(f"F1 preview assets: {args.output.resolve()}")


if __name__ == "__main__":
    main()
