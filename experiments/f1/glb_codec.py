"""Read and write the JSON and binary chunks in a generated GLB."""

import json
import struct


def unpack_glb(data):
    if len(data) < 28:
        raise ValueError("GLB 文件不完整，请重新导入地图。")
    magic, version, total, length, kind = struct.unpack_from("<4sIII4s", data)
    end = 20 + length
    if (magic, version, total, kind) != (b"glTF", 2, len(data), b"JSON") or end + 8 > len(data):
        raise ValueError("GLB 文件不完整，请重新导入地图。")
    binary_length, binary_kind = struct.unpack_from("<I4s", data, end)
    if binary_kind != b"BIN\0" or end + 8 + binary_length != len(data):
        raise ValueError("GLB 缺少完整的几何数据，请重新导入地图。")
    return json.loads(data[20:end]), memoryview(data)[end + 8:]


def pack_glb(document, binary):
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    padding = b"\0" * (-len(binary) % 4)
    binary_size = len(binary) + len(padding)
    header = struct.pack("<4sIII4s", b"glTF", 2, 28 + len(encoded) + binary_size, len(encoded), b"JSON")
    return b"".join((header, encoded, struct.pack("<I4s", binary_size, b"BIN\0"), binary, padding))
