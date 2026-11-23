"""Read F1 extent and model geometry from the indoor sample ZIP."""

import argparse
import json
import struct
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile


def read_varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise ValueError("Invalid Protobuf varint")


def read_fields(data):
    fields = defaultdict(list)
    offset = 0
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        number, wire_type = tag >> 3, tag & 7
        if wire_type == 0:
            value, offset = read_varint(data, offset)
        elif wire_type == 2:
            size, offset = read_varint(data, offset)
            value = data[offset : offset + size]
            offset += size
        elif wire_type in (1, 5):
            layout = "<d" if wire_type == 1 else "<f"
            value = struct.unpack_from(layout, data, offset)[0]
            offset += struct.calcsize(layout)
        else:
            raise ValueError(f"Unsupported Protobuf wire type {wire_type}")
        if offset > len(data):
            raise ValueError("Truncated Protobuf field")
        fields[number].append(value)
    return fields


def read_rings(geometry):
    outer = []
    holes = []
    coordinates = geometry[6]
    start = 0
    # Each index group has cumulative offsets into the flat XY array.
    # The first span in each group contributes to the exterior.
    for group in geometry[5]:
        for ring_index, end in enumerate(read_fields(group)[1]):
            span = coordinates[start:end]
            if end > len(coordinates) or len(span) < 6:
                raise ValueError("Invalid F1 ring offset")
            ring = list(zip(span[::2], span[1::2], strict=True))
            if ring_index == 0:
                outer.extend(ring)
            else:
                holes.append(ring)
            start = end
    if not outer or start != len(coordinates):
        raise ValueError("Incomplete F1 polygon coordinates")
    return outer, holes


def read_layer(kind, geometry_records, business_records):
    business_by_id = {}
    for record in business_records:
        business = read_fields(record)
        business_by_id[business[1][0]] = business

    features = []
    for record in geometry_records:
        geometry = read_fields(record)
        element_id = geometry[1][0]
        business = business_by_id.get(element_id, {})
        outer, holes = read_rings(geometry)
        features.append({
            "kind": kind,
            "id": element_id,
            "fid": business.get(2, [b""])[0].decode("utf-8") or None,
            "typeId": business.get(3, [None])[0],
            "name": business.get(4, [b""])[0].decode("utf-8") or None,
            "sourceHeight": geometry.get(3, [None])[0],
            "sourceBaseHeight": geometry.get(7, [None])[0],
            "outer": outer,
            "holes": holes,
        })
    return features


def read_f1(archive_path):
    map_id = archive_path.stem
    with ZipFile(archive_path) as archive:
        scene = read_fields(archive.read(f"{map_id}.scene.fmap"))
        geometry = read_fields(archive.read(f"{map_id}.floor.F1.geo.fmap"))
        business = read_fields(archive.read(f"{map_id}.floor.F1.biz.fmap"))

    floors = [read_fields(record) for record in scene[18]]
    floor_ids = {floor[2][0].decode("utf-8"): floor[1][0] for floor in floors}
    floor_id = floor_ids["F1"]
    for shard in (geometry, business):
        if shard[1][0].decode("utf-8") != map_id or shard[2][0] != floor_id:
            raise ValueError("F1 shard does not match the sample scene")

    extents = read_layer("extent", geometry[4], business[3])
    models = read_layer("model", geometry[5], business[4])
    return {
        "mapId": map_id,
        "floor": "F1",
        "floorId": floor_id,
        "floorIds": floor_ids,
        "mapCenter": [scene[1][0], scene[2][0]],
        "features": extents + models,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Indoor sample ZIP")
    parser.add_argument("output", type=Path, help="Path for the extracted F1 JSON")
    args = parser.parse_args()

    sample = read_f1(args.archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")
    features = sample["features"]
    print(f"F1 (ID {sample['floorId']}): {len(features)} features, "
          f"{sum(bool(feature['holes']) for feature in features)} with holes")


if __name__ == "__main__":
    main()
