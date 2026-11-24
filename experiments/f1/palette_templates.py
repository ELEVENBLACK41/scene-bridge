"""Resolve FengMap type IDs to whole-building preview materials."""

from collections import Counter
from io import BytesIO

from PIL import Image
from shapely.geometry import Polygon


# These are roles in this sample. Keep the original type ID in every exported node.
TYPE_ROLES = {
    "structure": (300000, 300001),
    "exhibit": (180100, 180200, 180300, 180400, 180500, 180600),
    "entrance": (200001, 200031),
    "hall": (300400,),
    "vertical": (200003, 200004, 200005, 200011, 200021),
    "room": (200205, 210100, 210200, 210300, 210400, 210403, 210405, 210406, 210502, 210600, 210601),
    "service": (200002, 200012, 200016, 200023, 200114, 200204, 200207, 200211, 210404, 260600, 300405, 300406),
    "utility": (200100, 200104, 200105, 200106, 200107, 200110, 200112, 200200),
    "parking": (200401, 200402),
}
ROLE_BY_TYPE = {type_id: role for role, ids in TYPE_ROLES.items() for type_id in ids}

ENTRANCE_GLOW_COLOR = "#ff9a38"
ENTRANCE_GLOW_STRENGTH = 3.2

# The reference FengMap viewer lifts the top-face colors slightly under its fill light.
SOURCE_FILL_GAIN = 1.085
ORIGINAL_GRAY_MIX = 0.05
ORIGINAL_GRAY_LEVEL = 136

def linear_rgb(hex_color):
    rgb = bytes.fromhex(hex_color.lstrip("#"))
    channels = [value / 255 for value in rgb]
    return [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]


def rgb_hex(value):
    return "#" + "".join(f"{int(channel):02x}" for channel in value.split(","))


def make_material(name, color, glow=None):
    material = {"name": name, "color": linear_rgb(color), "roughness": 0.78}
    if glow:
        emission, intensity = glow
        material["emission"] = [channel * intensity for channel in linear_rgb(emission)]
    return material


def reference_rgb(value):
    def encode(channel):
        channel = min(1, channel * SOURCE_FILL_GAIN)
        return 255 * (channel * 12.92 if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055)

    return [encode(channel) for channel in linear_rgb(rgb_hex(value))]


def reference_color(style, floor_rgb):
    alpha = float(style.get("alpha", 1))
    rgb = reference_rgb(style["color"])
    return "#" + "".join(f"{round(front * alpha + back * (1 - alpha)):02x}" for front, back in zip(rgb, floor_rgb))


def graphic_base_color(source):
    with Image.open(BytesIO(source)) as image:
        pixels = image.convert("RGBA")
        pixels.thumbnail((300, 300))
        colors = Counter(pixel[:3] for pixel in pixels.getdata() if pixel[3] >= 200)
    if colors:
        return "#" + "".join(f"{channel:02x}" for channel in colors.most_common(1)[0][0])
    return None


def original_model_material(name, color):
    muted = "#" + "".join(
        f"{round(channel + (ORIGINAL_GRAY_LEVEL - channel) * ORIGINAL_GRAY_MIX):02x}"
        for channel in bytes.fromhex(color.lstrip("#"))
    )
    return {**make_material(name, muted), "unlit": True}


def original_template(theme, type_ids, read_theme_image):
    store_styles = {str(row["id"]): row for row in theme.get("storetheme", [])}
    model_styles = {
        int(value): store_styles[str(rule["normalid"])]
        for entry in theme.get("floorapply", []) if str(entry["floorid"]) == "0"
        for rule in entry["typeapply"] if str(rule["normalid"]) in store_styles
        for value in str(rule["type"]).split(",") if value.strip().isdecimal()
    }
    floor_rule = next((
        rule
        for entry in theme.get("floorextentapply", []) if str(entry["floorid"]) == "0"
        for rule in entry["typeapply"] if str(rule["type"]) == "0"
    ), {"normalid": "0"})
    source_floor = next((row for row in theme.get("extenttheme", []) if str(row["id"]) == str(floor_rule["normalid"])),
                        {"color": "231,231,232"})
    floor_rgb = reference_rgb(source_floor["color"])
    model_colors = {key: reference_color(style, floor_rgb) for key, style in model_styles.items()}
    slab_color = "#f4f4f4"
    neutral = "#cbd0d3"
    materials = [
        {**make_material("浅灰楼面与通道", slab_color), "unlit": True},
        original_model_material("未匹配类别", neutral),
    ]
    indexes = {"extent": 0, "other": 1}
    for source_type in type_ids:
        if ROLE_BY_TYPE.get(source_type) == "hall":
            indexes[str(source_type)] = indexes["extent"]
            continue
        match = model_colors.get(source_type)
        indexes[str(source_type)] = len(materials) if match else 1
        if match:
            materials.append(original_model_material(f"FengMap {source_type}", match))

    fid_indexes = {}
    for rule in theme.get("storeapply", []):
        style = store_styles.get(str(rule["normalid"]))
        if not style:
            continue
        if float(style.get("alpha", 1)) == 0:
            # The SDK draws these event areas using an image over a transparent base.
            image = style.get("image")
            color = graphic_base_color(read_theme_image(image)) if image else None
        else:
            color = reference_color(style, floor_rgb)
        if color:
            for fid in str(rule["fids"]).split(","):
                fid_indexes[fid.strip()] = len(materials)
            materials.append(original_model_material(f"FengMap override {style['id']}", color))
    return {
        "id": "original", "label": "原图配色", "file": "building.glb",
        "background": rgb_hex(theme.get("viewtheme", {}).get("clearcolor", "241,242,247")), "fill": 1.65,
        "swatches": [slab_color, model_colors.get(180100, neutral), model_colors.get(200004, neutral)],
        "materials": materials, "indexes": indexes, "fidIndexes": fid_indexes,
    }


def lights_by_floor(floors, origin):
    result = {}
    for floor in floors:
        candidates = []
        for feature in floor["features"]:
            if feature["kind"] != "model" or ROLE_BY_TYPE.get(feature["typeId"]) not in {"entrance", "hall", "vertical"}:
                continue
            point = Polygon(feature["outer"], feature["holes"]).representative_point()
            candidates.append([point.x - origin[0], 6.5, origin[1] - point.y])
        selected = []
        if candidates:
            selected.append(candidates.pop(len(candidates) // 2))
        while candidates and len(selected) < 7:
            def clearance(point):
                return min((point[0] - lamp[0]) ** 2 + (point[2] - lamp[2]) ** 2 for lamp in selected)

            point = max(candidates, key=clearance)
            if clearance(point) < 30 ** 2:
                break
            candidates.remove(point)
            selected.append(point)
        result[str(floor["id"])] = selected
    return result


def semantic_template(template_id, label, background, fill, colors, type_ids, glows=None, lights=None):
    glows = glows or {}
    roles = {role: index for index, role in enumerate(colors)}
    roles.setdefault("hall", roles["entrance"])
    indexes = {"extent": roles["extent"], "other": roles["other"]}
    indexes.update({str(type_id): roles[ROLE_BY_TYPE.get(type_id, "other")] for type_id in type_ids})
    return {
        "id": template_id, "label": label, "file": f"building-{template_id}.glb",
        "background": background, "fill": fill,
        "swatches": [colors[role] for role in ("extent", "exhibit", "vertical")],
        "materials": [make_material(role, color, glows.get(role)) for role, color in colors.items()],
        "indexes": indexes,
        **({"lights": lights} if lights else {}),
    }


def make_templates(theme, floors, origin, read_theme_image):
    type_ids = sorted({f["typeId"] for floor in floors for f in floor["features"] if f["typeId"] is not None})
    positions = lights_by_floor(floors, origin)
    warm = semantic_template("warm", "暖光夜景", "#d5c9bb", 1.44, {
        "extent": "#cbbfb1", "structure": "#d8cfc2", "exhibit": "#e0d0bb", "entrance": "#e6b985",
        "hall": "#d5c8bb", "vertical": "#b3a595", "room": "#ded3c5", "service": "#c6c6b5",
        "utility": "#c2b6a6", "parking": "#d2c9bc", "other": "#d9cfc1",
    }, type_ids, glows={
        "entrance": (ENTRANCE_GLOW_COLOR, 1.0),
    }, lights={
        "color": linear_rgb("#ffe3c6"), "intensity": 76, "range": 24, "positions": positions,
    })
    entrance_material = next(i for i, material in enumerate(warm["materials"]) if material["name"] == "entrance")
    warm["materials"][entrance_material]["emissionStrength"] = ENTRANCE_GLOW_STRENGTH
    warm["entranceBloom"] = True
    warm["detailEmissionStrengths"] = {
        "Entrance glow": 3.25, "Portal and handrail lights": 3.1,
        "Route lamp glow": 3.1, "Display glass": 0.6, "Storefront lights": 1.2,
    }

    # A few larger shopfronts provide the darker counterpoint in the nighttime palette.
    accents = [feature["fid"] for floor in floors for feature in floor["features"] if is_storefront_accent(feature)]
    if accents:
        warm["fidIndexes"] = {fid: len(warm["materials"]) for fid in accents}
        warm["materials"].append(make_material("Mocha storefront", "#786557"))
    return [
        original_template(theme, type_ids, read_theme_image),
        semantic_template("category", "分类对比色", "#e6ece8", 1.65, {
            "extent": "#dce7e4", "structure": "#7c969e", "exhibit": "#f2a65f", "entrance": "#25b7a0",
            "vertical": "#9b75d6", "room": "#6195dd", "service": "#e6ce59", "utility": "#70a787",
            "parking": "#8b97b1", "other": "#a9b7bf",
        }, type_ids),
        warm,
        semantic_template("cool", "冷光导览", "#101b2c", 1.04, {
            "extent": "#23364e", "structure": "#49657d", "exhibit": "#7084b5", "entrance": "#4ccee4",
            "vertical": "#8fe5ed", "room": "#6188a8", "service": "#65bfad", "utility": "#52637b",
            "parking": "#596887", "other": "#72849a",
        }, type_ids, glows={
            "entrance": ("#67e4ff", 0.92), "vertical": ("#98f7ff", 0.62),
        }, lights={
            "color": linear_rgb("#92ceff"), "intensity": 890, "range": 42, "positions": positions,
        }),
        semantic_template("sandstone", "浅砂岩", "#f0e6d5", 1.82, {
            "extent": "#eddfc6", "structure": "#afa18a", "exhibit": "#c47d5c", "entrance": "#bcaa76",
            "vertical": "#cca569", "room": "#90a6a2", "service": "#7caa99", "utility": "#a09b8e",
            "parking": "#9b93a2", "other": "#bcb09e",
        }, type_ids),
    ]


def is_storefront_accent(feature):
    return bool(feature["fid"] and feature["typeId"] in (100101, 100102, 170100, 190501)
                and feature["id"] % 11 == 0 and feature["name"])
