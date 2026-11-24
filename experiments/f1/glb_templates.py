"""Write palette GLBs without changing the source geometry buffers."""

import copy
from math import cos, tau

import numpy as np

import trimesh

from build_glb import write_glb_bytes
from glb_codec import pack_glb, unpack_glb
from model_identity import apply_model_identity


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
    source_materials = document["materials"]
    palette = [material_json(material) for material in template["materials"]]
    document["materials"] = palette + source_materials
    detail_strengths = template.get("detailEmissionStrengths", {})
    for material in source_materials:
        name = material.get("name")
        if name == "Wayfinding lettering":
            material.setdefault("extensions", {})["KHR_materials_unlit"] = {}
        elif name in detail_strengths:
            material.setdefault("extensions", {})["KHR_materials_emissive_strength"] = {"emissiveStrength": detail_strengths[name]}
    extensions = {name for material in document["materials"] for name in material.get("extensions", {})}
    document["extensionsUsed"] = sorted(set(document.get("extensionsUsed", [])) | extensions)
    indexes = template["indexes"]
    fid_indexes = template.get("fidIndexes", {})
    assigned_meshes = set()
    for node in document["nodes"]:
        if "mesh" not in node or node["mesh"] in assigned_meshes:
            continue
        assigned_meshes.add(node["mesh"])
        source = node["extras"]
        primitives = document["meshes"][node["mesh"]]["primitives"]
        if source["kind"] == "detail":
            for primitive in primitives:
                primitive["material"] += len(palette)
            continue
        key = "extent" if source["kind"] == "extent" else str(source["sourceTypeId"])
        material = fid_indexes.get(source["sourceFid"], indexes.get(key, indexes["other"]))
        for primitive in primitives:
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


def add_route_animations(document, binary):
    nodes = document["nodes"]
    scenes = document["scenes"][document["scene"]]
    floors = [(nodes[root], [i for i in nodes[root].get("children", [])
                             if nodes[i].get("extras", {}).get("role") == "route lamp"])
              for root in scenes["nodes"]]
    if not any(lamps for _, lamps in floors):
        return binary

    packed = bytearray(binary)

    def append_accessor(values, value_type):
        data = np.asarray(values, dtype="<f4").tobytes()
        packed.extend(b"\0" * (-len(packed) % 4))
        views = document["bufferViews"]
        view = len(views)
        views.append({"buffer": 0, "byteOffset": len(packed), "byteLength": len(data)})
        packed.extend(data)
        accessors = document["accessors"]
        index = len(accessors)
        accessors.append({"bufferView": view, "componentType": 5126, "count": len(values), "type": value_type})
        return index

    times = np.linspace(0, 3.3, 37)
    time_index = append_accessor(times, "SCALAR")
    document["accessors"][time_index].update(min=[float(times[0])], max=[float(times[-1])])
    waves = []
    for phase in range(12):
        wave = [0.48 + 0.77 * max(0, cos(tau * (time / times[-1] - phase / 12))) ** 2.5 for time in times]
        values = [[value, 1, value] for value in wave]
        waves.append((append_accessor(values, "VEC3"), values[0]))

    for floor, lamps in floors:
        if not lamps:
            continue
        samplers, channels, phases = [], [], {}
        for lamp in lamps:
            node = nodes[lamp]
            phase = node["extras"]["phase"]
            output, resting_scale = waves[phase]
            if "matrix" in node:
                node["translation"] = node.pop("matrix")[12:15]
            node["scale"] = resting_scale
            if phase not in phases:
                phases[phase] = len(samplers)
                samplers.append({"input": time_index, "output": output, "interpolation": "LINEAR"})
            channels.append({"sampler": phases[phase], "target": {"node": lamp, "path": "scale"}})
        document.setdefault("animations", []).append({
            "name": f"Route lights {floor['name']}", "channels": channels, "samplers": samplers,
        })
    document["buffers"][0]["byteLength"] = len(packed)
    return packed


def write_template_models(scene, templates, output):
    source = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    original, binary = unpack_glb(source)
    apply_model_identity(original)
    binary = add_route_animations(original, binary)

    for template in templates:
        document = copy.deepcopy(original)
        apply_template(document, template)
        size = write_glb_bytes(pack_glb(document, binary), output / template["file"])
        print(f"{template['label']}: {size:,} bytes ({template['file']})")
