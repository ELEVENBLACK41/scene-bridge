"""Normalize FengMap uploads into the SDK's local asset layout."""

import json
import re
from pathlib import PurePosixPath
from zipfile import ZipFile, is_zipfile

from read_sample import read_fields, scene_metadata


MAP_SUFFIXES = {2: "geo", 3: "biz", 4: "navi"}
THEME_ASSETS = {".fmi", ".png", ".jpg", ".jpeg", ".webp", ".glb", ".gltf", ".bin"}
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def zip_members(archive):
    members = {}
    total = 0
    for item in archive.infolist():
        if item.is_dir():
            continue
        name = PurePosixPath(item.filename.replace("\\", "/"))
        if "__MACOSX" in name.parts or name.name.startswith("._"):
            continue
        if name.is_absolute() or ".." in name.parts or any(":" in part for part in name.parts):
            raise ValueError("ZIP 中包含不可用的资源路径")
        if name in members:
            raise ValueError(f"ZIP 中存在重复资源：{name.name}")
        total += item.file_size
        if total > MAX_ARCHIVE_BYTES:
            raise ValueError("ZIP 解包后的资源超过 512 MB")
        members[name] = item
    return members


def unpack_fmap(data):
    incomplete = "单个 .fmap 需要包含场景、楼层几何和业务分片。请上传完整 .fmap 或整套室内地图 ZIP。"
    fields = read_fields(data)
    identifier = fields[1][0] if fields[1] else None
    if not isinstance(identifier, bytes):
        raise ValueError(incomplete)
    map_id = identifier.decode("ascii")
    if not re.fullmatch(r"[0-9]+", map_id) or not fields[10]:
        raise ValueError(incomplete)

    blocks = {}
    try:
        for entry in fields[10]:
            block = read_fields(entry)
            level, kind, payload = block[1][0], block[3][0], block[5][0]
            if not isinstance(payload, bytes) or block[4][0] != len(payload) or (level, kind) in blocks:
                raise ValueError(incomplete)
            blocks[level, kind] = payload
    except (IndexError, TypeError, ValueError) as error:
        raise ValueError(incomplete) from error

    scene = blocks.get((0, 1))
    if not scene:
        raise ValueError(incomplete)
    _, floors = scene_metadata(scene)
    assets = {f"{map_id}.fmap": data, f"{map_id}.scene.fmap": scene}
    for name, level in floors.items():
        if not name or any(char in name for char in "/\\:"):
            raise ValueError("地图包含不可用的楼层名称")
        for kind, suffix in MAP_SUFFIXES.items():
            payload = blocks.get((level, kind))
            if payload:
                assets[f"{map_id}.floor.{name}.{suffix}.fmap"] = payload
    return map_id, assets


def read_map_upload(path):
    if not is_zipfile(path):
        return unpack_fmap(path.read_bytes())

    with ZipFile(path) as archive:
        members = zip_members(archive)
        scenes = [name for name in members if re.fullmatch(r"[0-9]+\.scene\.fmap", name.name)]
        if len(scenes) == 1:
            scene, = scenes
            map_id = scene.name.split(".", 1)[0]
            return map_id, {
                name.name: archive.read(item)
                for name, item in members.items()
                if name.parent == scene.parent and name.name.startswith(f"{map_id}.") and name.suffix == ".fmap"
            }
        if not scenes:
            bundles = [name for name in members if re.fullmatch(r"[0-9]+\.fmap", name.name)]
            if len(bundles) == 1:
                return unpack_fmap(archive.read(members[bundles[0]]))
            raise ValueError("地图 ZIP 中缺少完整 .fmap 或 .scene.fmap 场景文件")
        raise ValueError("地图 ZIP 中包含多套场景，请上传一套独立的室内地图")


def parse_theme(data):
    theme = json.loads(data.decode("utf-8-sig"))
    if not isinstance(theme, dict) or not {"viewtheme", "storetheme", "extenttheme"}.intersection(theme):
        raise ValueError("主题文件不是可识别的 FengMap 主题")
    return theme


def theme_references(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from theme_references(item)
    elif isinstance(value, list):
        for item in value:
            yield from theme_references(item)
    elif isinstance(value, str) and PurePosixPath(value).suffix.lower() in THEME_ASSETS:
        yield value


def read_theme_upload(path, original_name):
    if is_zipfile(path):
        with ZipFile(path) as archive:
            members = zip_members(archive)
            candidates = [
                (name, parse_theme(archive.read(item)))
                for name, item in members.items() if name.suffix.lower() == ".theme"
            ]
            indoor = [(name, theme) for name, theme in candidates if not theme.get("buildings")]
            if len(indoor) == 1:
                name, theme = indoor[0]
            elif len(candidates) == 1:
                name, theme = candidates[0]
            else:
                raise ValueError("主题 ZIP 需要包含一套可识别的室内主题")
            source = archive.read(members[name])
            assets = {
                item_path.relative_to(name.parent).as_posix(): archive.read(item)
                for item_path, item in members.items()
                if item_path.is_relative_to(name.parent) and item_path.suffix.lower() in THEME_ASSETS
            }
    else:
        name = PurePosixPath(original_name)
        source = path.read_bytes()
        theme = parse_theme(source)
        assets = {}

    missing = sorted(set(theme_references(theme)) - assets.keys())
    if missing:
        raise ValueError(f"主题缺少配套资源：{', '.join(missing[:3])}。请选择包含图片和模型的主题 ZIP。")
    theme_id = name.stem if re.fullmatch(r"[A-Za-z0-9_-]+", name.stem) else "local-theme"
    assets[f"{theme_id}.theme"] = source
    return theme_id, theme, assets


def write_assets(root, entries):
    for name, data in entries.items():
        output = root / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
