"""Export the selected palette as a spaced building or individual floor GLBs."""

import argparse
import copy
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from glb_codec import pack_glb, unpack_glb


def floor_roots(document, floors):
    scene = document["scenes"][document.get("scene", 0)]
    nodes = document["nodes"]
    roots = {}
    for index in scene["nodes"]:
        node = nodes[index]
        floor_id = node.get("extras", {}).get("floorId")
        if any("mesh" in nodes[child] for child in node.get("children", [])):
            roots[floor_id, node.get("name")] = index
    missing = [floor["name"] for floor in floors if (floor["id"], floor["name"]) not in roots]
    if missing:
        raise ValueError(f"GLB 缺少楼层：{'、'.join(missing)}。")
    return [roots[floor["id"], floor["name"]] for floor in floors]


def set_elevation(node, meters):
    if "matrix" in node:
        node["matrix"][13] = meters
    else:
        x, _, z = node.get("translation", [0, 0, 0])
        node["translation"] = [x, meters, z]


def subset(entries, indices):
    ordered = list(dict.fromkeys(indices))
    return [copy.deepcopy(entries[i]) for i in ordered], {old: new for new, old in enumerate(ordered)}


def floor_glb(document, binary, root):
    source_nodes = document["nodes"]
    # Follow the floor subtree, including the floor's configured lights.
    pending = [root]
    node_ids = []
    while pending:
        index = pending.pop()
        node_ids.append(index)
        pending.extend(reversed(source_nodes[index].get("children", [])))
    nodes, node_map = subset(source_nodes, node_ids)
    meshes, mesh_map = subset(document["meshes"], (node["mesh"] for node in nodes if "mesh" in node))
    primitives = [primitive for mesh in meshes for primitive in mesh["primitives"]]
    materials, material_map = subset(document["materials"], (p["material"] for p in primitives if "material" in p))
    color_textures = [material["pbrMetallicRoughness"]["baseColorTexture"] for material in materials
                      if "baseColorTexture" in material.get("pbrMetallicRoughness", {})]
    textures, texture_map = subset(document.get("textures", []), (texture["index"] for texture in color_textures))
    images, image_map = subset(document.get("images", []), (texture["source"] for texture in textures))
    accessor_ids = [index for p in primitives for index in p["attributes"].values()]
    accessor_ids += [p["indices"] for p in primitives if "indices" in p]
    animations = [copy.deepcopy(animation) for animation in document.get("animations", [])
                  if all(channel["target"]["node"] in node_map for channel in animation["channels"])]
    for animation in animations:
        for sampler in animation["samplers"]:
            accessor_ids.extend((sampler["input"], sampler["output"]))
    accessors, accessor_map = subset(document["accessors"], accessor_ids)
    views, view_map = subset(document["bufferViews"], (item["bufferView"] for item in [*accessors, *images]))

    # Copy only the buffer ranges this floor uses and keep glTF's four-byte alignment.
    packed = bytearray()
    for view in views:
        offset = view.get("byteOffset", 0)
        packed.extend(b"\0" * (-len(packed) % 4))
        view["byteOffset"] = len(packed)
        packed.extend(binary[offset:offset + view["byteLength"]])
    for item in [*accessors, *images]:
        item["bufferView"] = view_map[item["bufferView"]]
    for texture in color_textures:
        texture["index"] = texture_map[texture["index"]]
    for texture in textures:
        texture["source"] = image_map[texture["source"]]
    for primitive in primitives:
        primitive["attributes"] = {kind: accessor_map[i] for kind, i in primitive["attributes"].items()}
        if "indices" in primitive:
            primitive["indices"] = accessor_map[primitive["indices"]]
        if "material" in primitive:
            primitive["material"] = material_map[primitive["material"]]
    for node in nodes:
        if "children" in node:
            node["children"] = [node_map[child] for child in node["children"]]
        if "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]
    for animation in animations:
        for channel in animation["channels"]:
            target = channel["target"]
            target["node"] = node_map[target["node"]]
        for sampler in animation["samplers"]:
            sampler["input"] = accessor_map[sampler["input"]]
            sampler["output"] = accessor_map[sampler["output"]]
    set_elevation(nodes[0], 0)

    result = {
        **document,
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes, "meshes": meshes, "materials": materials,
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(packed)}],
    }
    if textures:
        result.update(textures=textures, images=images)
    else:
        for key in ("textures", "images", "samplers"):
            result.pop(key, None)
    if animations:
        result["animations"] = animations
    else:
        result.pop("animations", None)
    return pack_glb(result, packed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--mode", required=True, choices=("building", "floors"))
    parser.add_argument("--spacing", type=float, required=True)
    args = parser.parse_args()

    try:
        document, binary = unpack_glb(args.glb.read_bytes())
        sample = json.loads(args.manifest.read_text(encoding="utf-8"))
        floors = sample["floors"]
        roots = floor_roots(document, floors)
        if args.mode == "building":
            reference = next(i for i, floor in enumerate(floors) if floor["id"] == sample["defaultFloorId"])
            for index, root in enumerate(roots):
                set_elevation(document["nodes"][root], (index - reference) * args.spacing)
            args.output.write_bytes(pack_glb(document, binary))
        else:
            with ZipFile(args.output, "w", ZIP_DEFLATED) as archive:
                for floor, root in zip(floors, roots, strict=True):
                    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", floor["name"]).strip(" .") or "floor"
                    archive.writestr(f"{floor['id']}-{name}.glb", floor_glb(document, binary, root))
    except (ValueError, KeyError, IndexError, StopIteration) as error:
        parser.exit(2, f"{error}\n" if isinstance(error, ValueError) else "GLB 场景数据不完整，请重新导入。\n")


if __name__ == "__main__":
    main()
