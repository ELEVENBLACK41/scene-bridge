"""Build the indoor GLB and prepare local assets for the Next.js preview."""

import argparse
import json
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from import_assets import read_map_upload, read_theme_upload, write_assets
from read_sample import read_building, read_building_assets


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


def floor_manifest(floor, origin, is_reference):
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
    if is_reference and floor["name"] == "F1":
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

    xs, ys = zip(*(point for feature in features for point in feature["outer"]))
    return {
        "id": floor["id"],
        "name": floor["name"],
        "elevation": floor["elevation"],
        "bounds": [min(xs) - origin[0], origin[1] - max(ys), max(xs) - origin[0], origin[1] - min(ys)],
        "anchors": anchors,
    }


def write_preview(sample, theme_id, theme, read_image, output):
    from build_glb import build_floors
    from glb_templates import write_template_models
    from palette_templates import make_templates

    floors = sample["floors"]
    origin = sample["mapCenter"]
    default_index = next((index for index, floor in enumerate(floors) if floor["name"] == "F1"), 0)
    for index, floor in enumerate(floors):
        floor["elevation"] = (index - default_index) * FLOOR_SPACING
    templates = make_templates(theme, floors, origin, read_image)
    manifest = {
        "mapId": sample["mapId"],
        "themeId": theme_id,
        "defaultFloorId": floors[default_index]["id"],
        "floorSpacing": FLOOR_SPACING,
        "origin": origin,
        "model": templates[0]["file"],
        "templates": templates,
        "floors": [floor_manifest(floor, origin, sample["mapId"] == MAP_ID) for floor in floors],
    }

    scene = build_floors(sample["mapId"], origin, floors, include_details=True)
    write_template_models(scene, templates, output)
    (output / "sample.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    for floor in floors:
        print(f"{floor['name']}: {len(floor['features'])} source features, Y={floor['elevation']} m")
    print(f"{len(templates)} templates, {len(scene.geometry)} meshes per GLB ({output.resolve()})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Directory for the prepared preview")
    parser.add_argument("--map", type=Path, help="Complete .fmap or indoor map ZIP")
    parser.add_argument("--theme", type=Path, help="FengMap .theme or theme ZIP")
    parser.add_argument("--theme-name", help="Original uploaded theme filename")
    args = parser.parse_args()
    if bool(args.map) != bool(args.theme):
        parser.error("--map and --theme must be provided together")

    if args.map:
        try:
            map_id, map_assets = read_map_upload(args.map)
            sample = read_building_assets(map_assets.__getitem__, map_id)
            theme_id, theme, theme_assets = read_theme_upload(args.theme, args.theme_name or args.theme.name)
        except (BadZipFile, IndexError, KeyError, TypeError, UnicodeError, json.JSONDecodeError):
            parser.exit(2, "无法读取上传文件。请选择完整的室内地图和 FengMap 主题。\n")
        except ValueError as error:
            parser.exit(2, f"{error}\n")
        write_assets(args.output / "map" / map_id, map_assets)
        write_assets(args.output / "theme" / theme_id, theme_assets)
        try:
            write_preview(sample, theme_id, theme, theme_assets.__getitem__, args.output)
        except ValueError as error:
            parser.exit(2, f"生成 GLB 失败：{error}\n")
    else:
        prepare_map_assets(args.output)
        sample = read_building(MAP_ZIP)
        with ZipFile(THEME_ZIP) as archive:
            theme = json.loads(archive.read(f"{THEME_ID}/{THEME_ID}.theme"))
            write_preview(sample, THEME_ID, theme, lambda name: archive.read(f"{THEME_ID}/{name}"), args.output)


if __name__ == "__main__":
    main()
