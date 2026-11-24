"""Bake the source names into small shared textures for portable GLB labels."""

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont


CELL_WIDTH, CELL_HEIGHT = 240, 64
COLUMNS, ROWS = 8, 16
FONT_SIZE = 52
PADDING = 3


@lru_cache(maxsize=16)
def label_font(size):
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for path in (
        os.environ.get("SCENE_BRIDGE_LABEL_FONT"),
        windows_fonts / "msyh.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ):
        if path and Path(path).is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def lettering_layout(text):
    font = label_font(FONT_SIZE)
    width = font.getlength(text)
    if width > CELL_WIDTH - 2 * PADDING:
        font = label_font(max(8, int(FONT_SIZE * (CELL_WIDTH - 2 * PADDING) / width)))
    left, top, right, bottom = font.getbbox(text)
    return font, (left, top, right, bottom), (min(CELL_WIDTH, right - left + 2 * PADDING),
                                            min(CELL_HEIGHT, bottom - top + 2 * PADDING))


def fit_lettering(text, width, height):
    _, _, (ink_width, ink_height) = lettering_layout(text)
    scale = min(width / ink_width, height / ink_height)
    return ink_width * scale, ink_height * scale


def lettering_size(text, font_size):
    font, _, (width, height) = lettering_layout(text)
    scale = font_size / font.size
    return width * scale, height * scale


def write_labels(scene, floor_name, labels):
    batch = COLUMNS * ROWS
    for start in range(0, len(labels), batch):
        items = labels[start:start + batch]
        rows = (len(items) + COLUMNS - 1) // COLUMNS
        image = Image.new("RGBA", (COLUMNS * CELL_WIDTH, rows * CELL_HEIGHT))
        draw = ImageDraw.Draw(image)
        vertices, faces, uv = [], [], []
        for index, (text, corners, light_text) in enumerate(items):
            x = index % COLUMNS * CELL_WIDTH
            y = index // COLUMNS * CELL_HEIGHT
            font, (ink_x, ink_y, _, _), (width, height) = lettering_layout(text)
            draw.text((x + PADDING - ink_x, y + PADDING - ink_y), text, font=font,
                      fill="#f7ead8" if light_text else "#51453b")
            left, right = x / image.width, (x + width) / image.width
            top, bottom = 1 - y / image.height, 1 - (y + height) / image.height
            base = len(vertices)
            vertices.extend(corners)
            faces.extend(((base, base + 1, base + 2), (base, base + 2, base + 3)))
            uv.extend(((left, bottom), (right, bottom), (right, top), (left, top)))
        material = trimesh.visual.material.PBRMaterial(
            name="Wayfinding lettering", baseColorTexture=image, alphaMode="BLEND", metallicFactor=0, roughnessFactor=1,
        )
        mesh = trimesh.Trimesh(vertices=np.asarray(vertices), faces=faces, process=False)
        mesh.visual = trimesh.visual.TextureVisuals(uv=np.asarray(uv), material=material)
        name = f"{floor_name}_lettering_{start // batch + 1}"
        scene.add_geometry(mesh, node_name=name, geom_name=name, parent_node_name=floor_name,
                           metadata={"kind": "detail", "role": "lettering", "labels": [text for text, _, _ in items]})
