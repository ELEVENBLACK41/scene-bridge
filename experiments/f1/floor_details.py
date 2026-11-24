"""Build floor-local architectural details using the source feature footprints."""

from collections import defaultdict
from dataclasses import dataclass
import re
from math import atan2, hypot, pi

import numpy as np
import trimesh
from shapely import make_valid, union_all
from shapely.affinity import translate
from shapely.geometry import Point, Polygon
from shapely.ops import nearest_points

from floor_labels import fit_lettering, lettering_size, write_labels
from floor_navigation import circulation_routes, navigation_graph
from palette_templates import is_storefront_accent, linear_rgb


ENTRANCES = {200001, 200031}
STAIRS = {200003, 200005}
ROOF_FONT_SIZE = 1.15
ROOF_LINE_GAP = 0.16
DETAIL_MATERIALS = {
    "Bronze frames": ("#4d4136", None),
    "Champagne metal": ("#b8a48c", None),
    "Stone treads": ("#a29687", None),
    "Display glass": ("#e1bd93", "#ffd7ae"),
    "Entrance glow": ("#ffd9ad", "#ffcd94"),
    "Storefront lights": ("#f0d7b0", "#f9d7a8"),
    "Portal and handrail lights": ("#eec595", "#ffc577"),
    "Route lamp rims": ("#a8947b", "#846f52"),
    "Roof edging": ("#c4b6a7", None),
    "Plinth shadows": ("#978776", None),
    "Warm figures": ("#e6d6c2", None),
    "Clay figures": ("#b0826e", None),
    "Olive figures": ("#8b9180", None),
}


@dataclass(frozen=True)
class Frame:
    x: float
    z: float
    dx: float
    dz: float

    def point(self, x=0, y=0, z=0):
        return (self.x + x * self.dx - z * self.dz, y, self.z + x * self.dz + z * self.dx)

    def matrix(self):
        return np.array([[self.dx, 0, -self.dz, self.x], [0, 1, 0, 0],
                         [self.dz, 0, self.dx, self.z], [0, 0, 0, 1]])


def footprint(feature, origin):
    def local(ring):
        return [(x - origin[0], origin[1] - y) for x, y in ring]

    polygon = Polygon(local(feature["outer"]), [local(ring) for ring in feature["holes"]])
    return polygon if polygon.is_valid else make_valid(polygon)


def oriented_frame(polygon):
    rect = polygon.minimum_rotated_rectangle
    corners = list(rect.exterior.coords)
    edges = [(x2 - x1, z2 - z1) for (x1, z1), (x2, z2) in zip(corners, corners[1:])]
    dx, dz = max(edges, key=lambda edge: hypot(*edge))
    width, depth = hypot(dx, dz), min(hypot(*edge) for edge in edges)
    if dx < -1e-5 or (abs(dx) < 1e-5 and dz < 0):
        dx, dz = -dx, -dz
    center = rect.centroid
    return Frame(center.x, center.y, dx / width, dz / width), width, depth


def feature_role(feature):
    name, type_id = feature["name"] or "", feature["typeId"]
    if type_id in ENTRANCES or re.fullmatch(r"[0-9零一二三四五六七八九十]+号门", name.strip()):
        return "entrance"
    if type_id in STAIRS:
        return "stairs"
    if type_id and 100000 <= type_id < 200000 and name and name.strip():
        return "store"
    return None


class FloorDetails:
    def __init__(self):
        self.meshes = defaultdict(list)
        self.labels = []
        self.route_lights = []

    def add(self, role, mesh, frame):
        mesh.apply_transform(frame.matrix())
        self.meshes[role].append(mesh)

    def box(self, role, frame, position, dimensions, angle=0):
        transform = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
        transform[:3, 3] = position
        self.add(role, trimesh.creation.box(dimensions, transform=transform), frame)

    def cylinder(self, role, frame, position, radius, height, sections=8):
        transform = trimesh.transformations.rotation_matrix(-pi / 2, [1, 0, 0])
        transform[:3, 3] = position
        self.add(role, trimesh.creation.cylinder(radius, height, sections=sections, transform=transform), frame)

    def sphere(self, role, frame, position, radius):
        mesh = trimesh.creation.icosphere(subdivisions=1, radius=radius)
        mesh.apply_translation(position)
        self.add(role, mesh, frame)

    def inlay(self, role, surface, y):
        polygons = list(surface.geoms) if hasattr(surface, "geoms") else [surface]
        for polygon in polygons:
            if polygon.geom_type != "Polygon" or polygon.area < 0.025:
                continue
            points, faces = trimesh.creation.triangulate_polygon(polygon, engine="earcut")
            vertices = np.column_stack((points[:, 0], np.full(len(points), y), points[:, 1]))
            mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
            if mesh.face_normals[:, 1].mean() < 0:
                mesh.invert()
            self.meshes[role].append(mesh)

    def label(self, text, frame, position, size, fascia=False, light_text=False):
        x, y, z = position
        w, h = size[0] / 2, size[1] / 2
        if fascia:
            corners = [frame.point(x + dx, y + dy, z) for dx, dy in ((-w, -h), (w, -h), (w, h), (-w, h))]
        else:
            corners = [frame.point(x + dx, y, z + dz) for dx, dz in ((-w, h), (w, h), (w, -h), (-w, -h))]
        self.labels.append((text, corners, fascia or light_text))

    def write(self, scene, floor_name):
        for role, meshes in self.meshes.items():
            color, glow = DETAIL_MATERIALS[role]
            material = trimesh.visual.material.PBRMaterial(
                name=role, baseColorFactor=[*linear_rgb(color), 1],
                emissiveFactor=linear_rgb(glow) if glow else None,
                metallicFactor=0, roughnessFactor=0.73,
            )
            mesh = trimesh.util.concatenate(meshes)
            if role in {"Bronze frames", "Champagne metal", "Stone treads", "Display glass"}:
                mesh = trimesh.graph.smooth_shade(mesh, angle=np.radians(32), facet_minarea=None)
            mesh.visual = trimesh.visual.TextureVisuals(material=material)
            name = f"{floor_name}_{role.replace(' ', '_')}"
            scene.add_geometry(mesh, node_name=name, geom_name=name, parent_node_name=floor_name,
                               metadata={"kind": "detail", "role": role})
        write_labels(scene, floor_name, self.labels)
        if self.route_lights:
            material = trimesh.visual.material.PBRMaterial(
                name="Route lamp glow", baseColorFactor=[*linear_rgb("#e6bd8a"), 1],
                emissiveFactor=linear_rgb("#ffcf8a"), metallicFactor=0, roughnessFactor=0.5,
            )
            lamp = trimesh.creation.cylinder(0.24, 0.028, sections=16)
            lamp.apply_transform(trimesh.transformations.rotation_matrix(-pi / 2, [1, 0, 0]))
            lamp.visual = trimesh.visual.TextureVisuals(material=material)
            geometry_name = f"{floor_name}_route_lamp"
            scene.geometry[geometry_name] = lamp
            for index, (point, phase) in enumerate(self.route_lights):
                scene.graph.update(frame_from=floor_name, frame_to=f"{geometry_name}_{index}",
                                   geometry=geometry_name, translation=point,
                                   metadata={"kind": "detail", "role": "route lamp", "phase": phase})


def add_entrance(details, frame, width, text):
    width = min(width, 13)
    height, frame_width = 3.25, 0.29
    for direction in (-1, 1):
        x = direction * (width - frame_width) / 2
        details.box("Entrance glow", frame, (x, (height - frame_width) / 2, 0), (frame_width, height - frame_width, 0.34))
    details.box("Entrance glow", frame, (0, height - frame_width / 2, 0), (width, frame_width, 0.34))
    details.box("Champagne metal", frame, (0, 0.016, 0), (width, 0.028, 0.62))
    label = text or "出入口"
    details.label(label, frame, (0, 0.032, 0), fit_lettering(label, width * 0.76, 0.52))


def add_stairs(details, frame, length, width, top, escalator):
    width = min(width * 0.9, 3.5 if escalator else 3.2)
    length *= 0.92
    rise = min(max(top, 1.5), 3.25, length * 0.46)
    count = max(5, min(19, round(length / 0.61)))
    run = length / count
    angle = atan2(rise, length)
    for index in range(count):
        x = -length / 2 + (index + 0.5) * run
        y = rise * (index + 1) / count
        details.box("Stone treads", frame, (x, y * 0.5, 0), (run, y, width - 0.24))
        details.box("Champagne metal", frame, (x - run * 0.44, y + 0.012, 0), (0.055, 0.025, width - 0.26))
    for side in (-1, 1):
        z = side * (width / 2 - 0.055)
        details.box("Bronze frames", frame, (0, rise / 2 + 0.24, z), (hypot(length, rise), 0.55, 0.19), angle)
        details.box("Champagne metal", frame, (0, rise / 2 + 0.82, z), (hypot(length, rise), 0.10, 0.18), angle)
        if escalator:
            details.box("Portal and handrail lights", frame, (0, rise / 2 + 0.74, z),
                        (hypot(length, rise) * 0.98, 0.044, 0.21), angle)
        for ratio in (-0.44, -0.15, 0.15, 0.44):
            details.box("Bronze frames", frame, (length * ratio, rise * (ratio + 0.5) + 0.54, z), (0.067, 0.46, 0.067))
    return rise


def roof_label_options(name):
    yield (name,)
    # Prefer word boundaries, then balance the lengths of the two lines.
    cuts = sorted(range(1, len(name)), key=lambda cut: (
        not (name[cut - 1].isspace() or name[cut].isspace()), abs(len(name) - 2 * cut),
    ))
    for cut in cuts:
        yield name[:cut].rstrip(), name[cut:].lstrip()


def centered_roof_label(roof, center, outlines):
    off_center = []
    for lines, depth, outline in outlines:
        if roof.covers(translate(outline, xoff=center.x, yoff=center.y)):
            return center, lines, depth
        off_center.append((lines, depth, outline))
    if not off_center:
        return None

    # On an irregular roof, find the closest center that leaves room for the entire label.
    safe = roof.buffer(-0.001)
    best = None
    for lines, depth, outline in off_center:
        centers = safe
        for x, z in list(outline.exterior.coords)[:-1]:
            centers = centers.intersection(translate(safe, xoff=-x, yoff=-z))
            if centers.is_empty:
                break
        if centers.is_empty:
            continue
        for point in (nearest_points(center, centers)[1], centers.representative_point()):
            distance = center.distance(point)
            if (best is None or distance < best[0]) and roof.covers(translate(outline, xoff=point.x, yoff=point.y)):
                best = distance, point, lines, depth
    return best[1:] if best else None


def roof_label_outlines(name, axis, width, depth):
    for option in roof_label_options(name):
        lines = [(text, *lettering_size(text, ROOF_FONT_SIZE)) for text in option]
        label_width = max(line_width for _, line_width, _ in lines)
        label_depth = sum(line_depth for _, _, line_depth in lines) + (len(lines) - 1) * ROOF_LINE_GAP
        if label_width > width * 0.73 or label_depth > depth * (0.60 if len(lines) > 1 else 0.52):
            continue
        outline = Polygon([axis.point(x * label_width / 2, 0, z * label_depth / 2)[::2]
                           for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        yield lines, label_depth, outline


def add_roof_label(details, feature, polygon, frame, width, depth, screen_right):
    name = (feature["name"] or "").replace("%rn%", " ").strip()
    if not name or width < 0.8 or depth < 0.55:
        return
    inset = polygon.buffer(-min(0.42, depth * 0.10), join_style="mitre")
    roof = inset if inset.geom_type == "Polygon" and not inset.is_empty else polygon
    facing = 1 if frame.dx * screen_right[0] + frame.dz * screen_right[1] >= 0 else -1
    axis = Frame(0, 0, frame.dx * facing, frame.dz * facing)
    outlines = roof_label_outlines(name, axis, width, depth)
    layout = centered_roof_label(roof, polygon.centroid, outlines)
    if layout is None:
        return
    center, lines, block_depth = layout
    frame = Frame(center.x, center.y, axis.dx, axis.dz)
    height = feature["sourceHeight"] + 0.026
    light_text = is_storefront_accent(feature)
    z = -block_depth / 2
    for text, line_width, line_depth in lines:
        details.label(text, frame, (0, height, z + line_depth / 2), (line_width, line_depth), light_text=light_text)
        z += line_depth + ROOF_LINE_GAP


def storefront_frame(polygon, solids, walkways):
    corners = list(polygon.simplify(0.13, preserve_topology=True).exterior.coords)
    result = None
    best = 0
    for (x1, z1), (x2, z2) in zip(corners, corners[1:]):
        length = hypot(x2 - x1, z2 - z1)
        if length < 3.1:
            continue
        x, z = (x1 + x2) / 2, (z1 + z2) / 2
        dx, dz = (x2 - x1) / length, (z2 - z1) / length
        outward = Point(x - dz * 0.55, z + dx * 0.55)
        if polygon.covers(outward):
            dx, dz = -dx, -dz
            outward = Point(x - dz * 0.55, z + dx * 0.55)
        if solids.covers(outward):
            continue
        clearance = walkways.distance(outward) if not walkways.is_empty else 8
        score = length / (1 + clearance / 7)
        if score > best:
            best, result = score, (Frame(x, z, dx, dz), length)
    return result


def add_storefront(details, frame, length, top, name, lit):
    width = min(length * 0.87, 13.5)
    canopy_y = top - 0.27
    details.box("Bronze frames", frame, (0, canopy_y, 0.19), (width + 0.22, 0.37, 0.57))
    details.box("Champagne metal", frame, (0, canopy_y - 0.2, 0.44), (width, 0.045, 0.10))
    if lit:
        details.box("Storefront lights", frame, (0, canopy_y - 0.16, 0.468), (width * 0.82, 0.064, 0.055))
    details.box("Display glass", frame, (0, canopy_y * 0.46, 0.15), (width, canopy_y * 0.92, 0.32))
    details.box("Bronze frames", frame, (0, 0.11, 0.25), (width, 0.22, 0.26))
    bays = max(3, min(7, round(width / 1.55)))
    for index in range(bays + 1):
        x = width * (index / bays - 0.5)
        details.box("Bronze frames", frame, (x, canopy_y / 2, 0.29), (0.095, canopy_y, 0.14))
    for x in (-0.57, 0.57):
        details.box("Bronze frames", frame, (x, canopy_y * 0.45, 0.34), (0.07, canopy_y * 0.88, 0.13))
        details.box("Champagne metal", frame, (x * 0.42, canopy_y * 0.44, 0.36), (0.05, 0.33, 0.08))
    label = name.replace("%rn%", " ").strip()
    details.label(label, frame, (0, canopy_y + 0.025, 0.49), fit_lettering(label, width * 0.8, 0.31), fascia=True)


def add_figure(details, frame, index):
    role = ("Warm figures", "Clay figures", "Olive figures")[index % 3]
    details.cylinder("Plinth shadows", frame, (0, 0.017, 0), 0.38, 0.012, sections=10)
    for side in (-1, 1):
        details.box("Bronze frames", frame, (side * 0.105, 0.33, side * 0.05), (0.13, 0.65, 0.17), side * 0.045)
        details.box(role, frame, (side * 0.28, 1.05, 0), (0.11, 0.48, 0.14), -side * 0.16)
    details.cylinder(role, frame, (0, 0.98, 0), 0.225, 0.68)
    details.sphere("Warm figures", frame, (0, 1.48, 0), 0.135)


def add_circulation(details, routes, slab, solids):
    people = []
    lamp_points = []
    spacing = 2.65
    for route, phase_distance in routes:
        lamp_count = max(1, round(route.length / spacing))
        for index, distance in enumerate(np.linspace(route.length / (lamp_count * 2),
                                                     route.length - route.length / (lamp_count * 2), lamp_count)):
            point = route.interpolate(distance)
            before, after = route.interpolate(max(0, distance - 0.37)), route.interpolate(distance + 0.37)
            dx, dz = after.x - before.x, after.y - before.y
            if (hypot(dx, dz) < 0.1 or not slab.covers(point) or solids.covers(point)
                    or any(hypot(point.x - x, point.y - z) < 1.3 for x, z in lamp_points)):
                continue
            size = hypot(dx, dz)
            frame = Frame(point.x, point.y, dx / size, dz / size)
            lamp_points.append((point.x, point.y))
            details.cylinder("Route lamp rims", frame, (0, 0.014, 0), 0.32, 0.025, sections=16)
            details.route_lights.append((frame.point(y=0.032), round((phase_distance + distance) / spacing) % 12))
            if len(people) < 22 and index % 4 == 1:
                for offset in (1.6, -1.8):
                    x, _, z = frame.point(z=offset)
                    person = Point(x, z)
                    if slab.distance(person) == 0 and person.distance(solids) > 0.42:
                        people.append(Frame(x, z, frame.dx, frame.dz))
                        break
    for index, frame in enumerate(people):
        add_figure(details, frame, index)


def prepare_floor_details(floor, origin):
    features = floor["features"]
    polygons = {id(feature): footprint(feature, origin) for feature in features}
    slab = union_all([polygons[id(feature)] for feature in features if feature["kind"] == "extent"])
    min_x, min_z, max_x, max_z = slab.bounds
    screen_right = (0.31, -1) if max_z - min_z > max_x - min_x else (1, -0.31)
    solids = union_all([polygons[id(feature)] for feature in features
                        if feature["kind"] == "model" and feature["sourceHeight"] > 0.85 and feature_role(feature) != "stairs"])
    points, graph, walkways = navigation_graph(floor.get("navigation"), origin)
    details = FloorDetails()
    replacements, entrances, transfers = set(), [], []
    shop_footprints = {}
    for feature in features:
        polygon = polygons[id(feature)]
        if feature["kind"] != "model" or polygon.geom_type != "Polygon" or polygon.area < 0.12:
            continue
        role = feature_role(feature)
        if not role and not feature["name"]:
            continue
        if role == "store":
            inset = polygon.buffer(-0.19, join_style="mitre")
            if inset.geom_type == "Polygon" and inset.area >= polygon.area * 0.75:
                polygon = shop_footprints[feature["id"]] = inset
        frame, width, depth = oriented_frame(polygon)
        top = feature["sourceHeight"]
        if role == "entrance" and width >= 1.2:
            add_entrance(details, frame, width, feature["name"])
            entrances.append((frame.x, frame.z))
            replacements.add(feature["id"])
        elif role == "stairs" and width >= 2.6 and depth >= 1:
            escalator = feature["typeId"] == 200003
            if feature["id"] % 2:
                frame = Frame(frame.x, frame.z, -frame.dx, -frame.dz)
            rise = add_stairs(details, frame, width, depth, top, escalator)
            label = feature["name"] or ("扶梯" if escalator else "楼梯")
            details.label(label, frame,
                          (width * 0.28, rise * 0.78 + 0.29, min(depth * 0.9, 3.5 if escalator else 3.2) / 2 + 0.05),
                          fit_lettering(label, min(1.8, width * 0.3), 0.16), fascia=True)
            if escalator:
                transfers.append((frame.x, frame.z))
            replacements.add(feature["id"])
        else:
            add_roof_label(details, feature, polygon, frame, width, depth, screen_right)
            if role == "store" and 1.75 <= top <= 10:
                outline = polygon.buffer(-0.18, join_style="mitre").difference(polygon.buffer(-0.30, join_style="mitre"))
                details.inlay("Roof edging", outline, top + 0.012)
                facade = storefront_frame(polygon, solids, walkways)
                if facade:
                    add_storefront(details, *facade, top, feature["name"], lit=feature["id"] % 3 == 0)
    stairs = union_all([polygons[id(feature)] for feature in features if feature_role(feature) == "stairs"])
    route_obstacles = solids.union(stairs)
    routes = circulation_routes(points, graph, entrances, transfers, slab, route_obstacles)
    add_circulation(details, routes, slab, route_obstacles)
    return details, replacements, shop_footprints
