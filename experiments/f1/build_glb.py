"""Build a Y-up GLB from the extracted indoor geometry."""

import argparse
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import trimesh
from shapely import constrained_delaunay_triangles, make_valid
from shapely.affinity import scale
from shapely.geometry import Polygon


def extrude_footprint(polygon, height, transform, name):
    repaired = not polygon.is_valid
    if repaired:
        polygon = make_valid(polygon)
    if polygon.geom_type != "Polygon" or polygon.area <= 0:
        raise ValueError(f"{name} has an invalid footprint")

    mesh = trimesh.creation.extrude_polygon(polygon, height, engine="earcut", transform=transform)
    if mesh.is_watertight:
        return mesh, repaired

    # Resolve coincident edges at touching rings before the second triangulation.
    tolerance = 0.0001
    cleaned = polygon.buffer(-tolerance, join_style="mitre").buffer(tolerance, join_style="mitre")
    if cleaned.geom_type == "Polygon" and cleaned.area > 0:
        mesh = trimesh.creation.extrude_polygon(cleaned, height, engine="earcut", transform=transform)
        if mesh.is_watertight:
            return mesh, True

    # Constrained triangulation keeps the source boundary and holes if Earcut leaves a non-manifold edge.
    caps = constrained_delaunay_triangles(polygon)
    coordinates = [xy for triangle in caps.geoms for xy in list(triangle.exterior.coords)[:3]]
    vertices, indices = np.unique(np.asarray(coordinates), axis=0, return_inverse=True)
    mesh = trimesh.creation.extrude_triangulation(vertices, indices.reshape(-1, 3), height, transform=transform)
    if not mesh.is_watertight:
        raise ValueError(f"{name} extrusion is not watertight")
    return mesh, True


def build_scene(sample):
    floor = {
        "name": sample["floor"], "id": sample["floorId"],
        "elevation": 0, "features": sample["features"],
    }
    return build_floors(sample["mapId"], sample["mapCenter"], [floor])


def build_floors(map_id, map_center, floors, include_details=False):
    from floor_details import prepare_floor_details

    origin = np.asarray(map_center, dtype=np.float64)
    scene = trimesh.Scene()
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
    datum = "floor-relative" if len(floors) == 1 else "illustrative"
    for floor in floors:
        details, replacements, shop_footprints = prepare_floor_details(floor, origin) if include_details else (None, set(), {})
        scene.graph.update(
            frame_to=floor["name"],
            translation=[0, floor["elevation"], 0],
            metadata={
                "mapId": map_id, "floorId": floor["id"], "mapOriginXY": origin.tolist(),
                "verticalDatum": datum,
                **({"replacedSourceIds": sorted(replacements)} if replacements else {}),
            },
        )
        add_floor_geometry(scene, floor, origin, materials, replacements, include_details, shop_footprints)
        if details:
            details.write(scene, floor["name"])
    return scene


def add_floor_geometry(scene, floor, origin, materials, replacements, include_details, shop_footprints):
    for feature in floor["features"]:
        kind = feature["kind"]
        if kind == "model" and feature["id"] in replacements:
            continue
        name = f"{floor['name']}_{kind}_{feature['id']}"
        shop = shop_footprints.get(feature["id"]) if kind == "model" else None
        if shop is not None:
            polygon = scale(shop, yfact=-1, origin=(0, 0))
        else:
            polygon = Polygon(
                np.asarray(feature["outer"]) - origin,
                [np.asarray(ring) - origin for ring in feature["holes"]],
            )
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
        mesh, repaired = extrude_footprint(polygon, top - base, transform, name)
        if include_details:
            # Keep the roof planes and wall corners crisp while smoothing curved storefronts.
            mesh = trimesh.graph.smooth_shade(mesh, angle=np.radians(32), facet_minarea=None)
        mesh.visual = trimesh.visual.TextureVisuals(material=materials[kind])
        scene.add_geometry(
            mesh, node_name=name, geom_name=name, parent_node_name=floor["name"],
            metadata={
                "kind": kind,
                "sourceId": feature["id"],
                "sourceFid": feature["fid"],
                "sourceTypeId": feature["typeId"],
                "sourceName": feature["name"],
                "sourceHeight": feature["sourceHeight"],
                "sourceBaseHeight": feature["sourceBaseHeight"],
                **({"footprintRepaired": True} if repaired else {}),
            },
        )


def write_glb(scene, output):
    glb = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    return write_glb_bytes(glb, output)


def write_glb_bytes(glb, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, delete=False) as temporary:
        temporary.write(glb)
    temporary_path = Path(temporary.name)
    try:
        temporary_path.replace(output)
    finally:
        temporary_path.unlink(missing_ok=True)
    return len(glb)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("geometry_json", type=Path, help="JSON from read_sample.py")
    parser.add_argument("output", type=Path, help="Output .glb file")
    args = parser.parse_args()

    sample = json.loads(args.geometry_json.read_text(encoding="utf-8"))
    scene = build_scene(sample)
    size = write_glb(scene, args.output)
    print(f"{sample['floor']}: {len(scene.geometry)} meshes, {size:,} bytes")


if __name__ == "__main__":
    main()
