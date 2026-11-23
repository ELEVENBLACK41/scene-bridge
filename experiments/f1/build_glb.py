"""Build a Y-up GLB from the extracted F1 geometry JSON."""

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Polygon


def build_scene(sample):
    origin = np.asarray(sample["mapCenter"], dtype=np.float64)
    floor = sample["floor"]
    scene = trimesh.Scene()
    scene.graph.update(frame_to=floor, metadata={
        "mapId": sample["mapId"],
        "floorId": sample["floorId"],
        "mapOriginXY": origin.tolist(),
        "verticalDatum": "floor-relative",
    })

    materials = {
        "extent": trimesh.visual.material.PBRMaterial(
            name="Floor", baseColorFactor=[175, 186, 199, 255],
            metallicFactor=0.0, roughnessFactor=0.8,
        ),
        "model": trimesh.visual.material.PBRMaterial(
            name="Model", baseColorFactor=[88, 138, 169, 255],
            metallicFactor=0.0, roughnessFactor=0.8,
        ),
    }

    for feature in sample["features"]:
        kind = feature["kind"]
        name = f"{floor}_{kind}_{feature['id']}"
        polygon = Polygon(
            np.asarray(feature["outer"]) - origin,
            [np.asarray(ring) - origin for ring in feature["holes"]],
        )
        if not polygon.is_valid or polygon.area <= 0:
            raise ValueError(f"{name} has an invalid footprint")

        top = feature["sourceHeight"]
        base = feature["sourceBaseHeight"]
        if kind == "extent":
            # FengMap renders the floor slab down from the floor datum.
            base, top = -top, 0.0

        # Extrude in XY/Z, then map east/up/south to glTF X/Y/Z.
        transform = np.array([
            [1, 0, 0, 0],
            [0, 0, 1, base],
            [0, -1, 0, 0],
            [0, 0, 0, 1],
        ])
        mesh = trimesh.creation.extrude_polygon(
            polygon, top - base, engine="earcut", transform=transform,
        )
        mesh.visual = trimesh.visual.TextureVisuals(material=materials[kind])
        scene.add_geometry(
            mesh, node_name=name, geom_name=name, parent_node_name=floor,
            metadata={
                "kind": kind,
                "sourceId": feature["id"],
                "sourceFid": feature["fid"],
                "sourceTypeId": feature["typeId"],
                "sourceName": feature["name"],
                "sourceHeight": feature["sourceHeight"],
                "sourceBaseHeight": feature["sourceBaseHeight"],
            },
        )
    return scene


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("geometry_json", type=Path, help="JSON from read_sample.py")
    parser.add_argument("output", type=Path, help="Output .glb file")
    args = parser.parse_args()

    sample = json.loads(args.geometry_json.read_text(encoding="utf-8"))
    scene = build_scene(sample)
    glb = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(glb)
    print(f"{sample['floor']}: {len(scene.geometry)} meshes, {len(glb):,} bytes")


if __name__ == "__main__":
    main()
