"""Write palette GLBs without changing the source geometry buffers."""

import copy

import trimesh

from build_glb import write_glb_bytes
from glb_codec import pack_glb, unpack_glb


def material_json(material):
    result = {
        "name": material["name"],
        "pbrMetallicRoughness": {
            "baseColorFactor": [*material["color"], 1],
            "metallicFactor": 0,
            "roughnessFactor": material["roughness"],
        },
    }
    if "emission" in material:
        result["emissiveFactor"] = material["emission"]
    if material.get("unlit"):
        result["extensions"] = {"KHR_materials_unlit": {}}
    if "emissionStrength" in material:
        result.setdefault("extensions", {})["KHR_materials_emissive_strength"] = {
            "emissiveStrength": material["emissionStrength"],
        }
    return result


def apply_template(document, template):
    document["asset"].setdefault("extras", {})["sceneBridgeTemplate"] = template["id"]
    document["materials"] = [material_json(material) for material in template["materials"]]
    if any(material.get("unlit") for material in template["materials"]):
        document.setdefault("extensionsUsed", []).append("KHR_materials_unlit")
    if any("emissionStrength" in material for material in template["materials"]):
        document.setdefault("extensionsUsed", []).append("KHR_materials_emissive_strength")
    indexes = template["indexes"]
    fid_indexes = template.get("fidIndexes", {})
    for node in document["nodes"]:
        if "mesh" not in node:
            continue
        source = node["extras"]
        key = "extent" if source["kind"] == "extent" else str(source["sourceTypeId"])
        material = fid_indexes.get(source["sourceFid"], indexes.get(key, indexes["other"]))
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            primitive["material"] = material

    if "lights" in template:
        add_point_lights(document, template["lights"])


def add_point_lights(document, lights):
    extension = "KHR_lights_punctual"
    document.setdefault("extensionsUsed", []).append(extension)
    document.setdefault("extensions", {})[extension] = {
        "lights": [{
            "type": "point", "color": lights["color"],
            "intensity": lights["intensity"], "range": lights["range"],
        }]
    }
    scene = document["scenes"][document["scene"]]
    for floor_index in scene["nodes"]:
        floor = document["nodes"][floor_index]
        positions = lights["positions"][str(floor["extras"]["floorId"])]
        for index, position in enumerate(positions, start=1):
            floor["children"].append(len(document["nodes"]))
            document["nodes"].append({
                "name": f"{floor['name']}_light_{index}",
                "translation": position,
                "extensions": {extension: {"light": 0}},
            })


def write_template_models(scene, templates, output):
    source = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    original, binary = unpack_glb(source)

    for template in templates:
        document = copy.deepcopy(original)
        apply_template(document, template)
        size = write_glb_bytes(pack_glb(document, binary), output / template["file"])
        print(f"{template['label']}: {size:,} bytes ({template['file']})")
