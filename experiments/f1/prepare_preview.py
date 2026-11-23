"""Build the indoor GLB and prepare local assets for the Next.js preview."""

import argparse
import json
from pathlib import Path
from zipfile import ZipFile

from read_sample import read_building


MAP_ID = "2067155016009707521"
THEME_ID = "2067158499815383041"
RESOURCES = Path(__file__).resolve().parents[2] / "fengMap"
MAP_ZIP = RESOURCES / "单独室内" / f"{MAP_ID}.zip"
THEME_ZIP = RESOURCES / "室内外一体化主题" / "2067162143855890434.zip"
FLOOR_SPACING = 4


def prepare_map_assets(root):
    with ZipFile(MAP_ZIP) as archive:
        archive.extractall(root / "map" / MAP_ID)
    with ZipFile(THEME_ZIP) as archive:
        indoor_files = [name for name in archive.namelist() if name.startswith(f"{THEME_ID}/")]
        archive.extractall(root / "theme", members=indoor_files)


def floor_manifest(floor):
    from shapely.geometry import Polygon

    features = floor["features"]
    with_hole = next(
        (feature for feature in features if feature["kind"] == "extent" and feature["holes"]),
        None,
    )
    models = [feature for feature in features if feature["kind"] == "model"]
    if with_hole is None:
        with_hole = next((feature for feature in models if feature["holes"]), None)
    checkpoints = []
    if with_hole:
        label = "楼板孔洞" if with_hole["kind"] == "extent" else "模型孔洞"
        checkpoints.append((with_hole, label, True))
    if floor["name"] == "F1":
        names = {58: "贵宾室 N1-3", 134: "会议室 N101", 172: "男洗手间"}
        checkpoints += [(feature, names[feature["id"]], False) for feature in models if feature["id"] in names]
    else:
        unique_names = set()
        for feature in models:
            label = feature["name"]
            if label and label not in unique_names:
                unique_names.add(label)
                checkpoints.append((feature, label.replace("%rn%", " "), False))
            if len(unique_names) == 2:
                break

    anchors = []
    for feature, label, is_hole in checkpoints:
        kind = feature["kind"]
        ring = feature["holes"][0] if is_hole else feature["outer"]
        point = Polygon(ring).representative_point()
        anchors.append({
            "kind": kind,
            "sourceId": feature["id"],
            "label": label,
            "point": [point.x, point.y],
            "height": 0 if kind == "extent" else feature["sourceHeight"],
        })

    return {
        "id": floor["id"],
        "name": floor["name"],
        "elevation": floor["elevation"],
        "anchors": anchors,
    }


def main():
    from build_glb import build_floors
    from glb_templates import write_template_models
    from palette_templates import make_templates

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Directory for SCENE_BRIDGE_F1_ASSETS")
    args = parser.parse_args()

    sample = read_building(MAP_ZIP)
    floors = sample["floors"]
    default_index = next((index for index, floor in enumerate(floors) if floor["name"] == "F1"), 0)
    for index, floor in enumerate(floors):
        floor["elevation"] = (index - default_index) * FLOOR_SPACING
    with ZipFile(THEME_ZIP) as archive:
        theme = json.loads(archive.read(f"{THEME_ID}/{THEME_ID}.theme"))
        templates = make_templates(theme, floors, sample["mapCenter"], lambda name: archive.read(f"{THEME_ID}/{name}"))
    manifest = {
        "mapId": sample["mapId"],
        "themeId": THEME_ID,
        "defaultFloorId": floors[default_index]["id"],
        "floorSpacing": FLOOR_SPACING,
        "origin": sample["mapCenter"],
        "model": templates[0]["file"],
        "templates": templates,
        "floors": [floor_manifest(floor) for floor in floors],
    }

    scene = build_floors(sample["mapId"], sample["mapCenter"], floors)
    prepare_map_assets(args.output)
    write_template_models(scene, templates, args.output)
    (args.output / "sample.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    for floor in floors:
        print(f"{floor['name']}: {len(floor['features'])} meshes, Y={floor['elevation']} m")
    print(f"{len(templates)} templates, {len(scene.geometry)} meshes per GLB ({args.output.resolve()})")


if __name__ == "__main__":
    main()
