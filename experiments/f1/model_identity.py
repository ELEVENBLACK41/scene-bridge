"""Expose FengMap business data on the corresponding glTF objects."""

from collections import Counter


def apply_model_identity(document):
    nodes = document["nodes"]
    mesh_uses = Counter(node["mesh"] for node in nodes if "mesh" in node)
    for node in nodes:
        source = node.get("extras", {})
        if source.get("kind") != "model":
            continue

        name = source.get("sourceName")
        fid = source.get("sourceFid")
        identity = {key: value for key, value in (("name", name), ("fid", fid)) if value is not None}
        if not identity:
            continue

        source.update(identity)
        display_name = " ".join((name or "").replace("%rn%", " ").split())
        label = display_name or "模型"
        identifier = fid or f"ID {source['sourceId']}"
        node["name"] = f"{label} [{identifier}]"

        # glTF permits many nodes to share one mesh, but their feature identities can differ.
        mesh_index = node.get("mesh")
        if mesh_uses[mesh_index] == 1:
            mesh = document["meshes"][mesh_index]
            mesh["name"] = node["name"]
            mesh.setdefault("extras", {}).update(identity)
