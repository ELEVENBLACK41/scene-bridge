"""Connect public corridors on the floor's FengMap navigation graph."""

from collections import defaultdict
from heapq import heappop, heappush
from math import dist
from struct import error as StructError

from shapely.geometry import LineString, MultiLineString, Polygon

from read_sample import read_fields


def navigation_graph(data, origin):
    if not data:
        return {}, {}, MultiLineString([])

    try:
        fields = read_fields(data)
        nodes = [read_fields(node) for node in fields[3]]
        edges = [read_fields(edge) for edge in fields[4]]
    except (IndexError, TypeError, ValueError, StructError):
        return {}, {}, MultiLineString([])

    points = {
        node[1][0]: (node[13][0] - origin[0], origin[1] - node[13][1])
        for node in nodes if node[1] and len(node[13]) == 2
    }
    graph = {node: [] for node in points}
    lines = []
    for edge in edges:
        if not edge[2] or not edge[3]:
            continue
        start, end = edge[2][0], edge[3][0]
        if start not in points or end not in points or points[start] == points[end]:
            continue
        length = dist(points[start], points[end])
        graph[start].append((end, length))
        graph[end].append((start, length))
        lines.append((points[start], points[end]))
    return {node: point for node, point in points.items() if graph[node]}, graph, MultiLineString(lines)


def shortest_paths(graph, start, end=None, terminals=()):
    distances = {start: 0.0}
    previous = {}
    pending = [(0.0, start)]
    while pending:
        distance, node = heappop(pending)
        if distance > distances[node]:
            continue
        if node == end:
            break
        if node != start and node in terminals:
            continue
        for neighbor, length in graph.get(node, ()):
            candidate = distance + length
            if candidate < distances.get(neighbor, float("inf")):
                distances[neighbor] = candidate
                previous[neighbor] = node
                heappush(pending, (candidate, neighbor))
    return distances, previous


def trace_path(previous, start, end):
    path = [end]
    while path[-1] != start:
        path.append(previous[path[-1]])
    return path[::-1]


def path_edges(path):
    return {tuple(sorted(pair)) for pair in zip(path, path[1:])}


def public_corridors(points, graph, slab, solids):
    walkable = slab.difference(solids)
    boundary = walkable.boundary
    interior = slab.buffer(-1.1)
    if not solids.is_empty:
        interior = interior.intersection(solids.convex_hull.buffer(1.5))
    corridors = defaultdict(list)
    for start, neighbors in graph.items():
        for end, distance in neighbors:
            if end <= start:
                continue
            segment = LineString((points[start], points[end]))
            midpoint = segment.interpolate(0.5, normalized=True)
            if interior.covers(midpoint) and walkable.covers(segment) and boundary.distance(midpoint) >= 1.15:
                corridors[start].append((end, distance))
                corridors[end].append((start, distance))
    return corridors


def corridor_chains(graph, points, distances):
    remaining = {tuple(sorted((node, neighbor))) for node, edges in graph.items() for neighbor, _ in edges}
    for start in sorted(graph, key=lambda node: (len(graph[node]) == 2, node)):
        for end, _ in graph[start]:
            edge = tuple(sorted((start, end)))
            if edge not in remaining:
                continue
            remaining.remove(edge)
            path = [start, end]
            while len(graph[path[-1]]) == 2:
                previous, current = path[-2:]
                following = next(neighbor for neighbor, _ in graph[current] if neighbor != previous)
                edge = tuple(sorted((current, following)))
                if edge not in remaining:
                    break
                remaining.remove(edge)
                path.append(following)
            if distances[path[-1]] < distances[path[0]]:
                path.reverse()
            yield LineString([points[node] for node in path]), distances[path[0]]


def corridor_loops(points, corridors, selected, used, center):
    # An alternate corridor can split and rejoin even when it is not the shortest path.
    unused = {node: [(neighbor, length) for neighbor, length in edges
                     if tuple(sorted((node, neighbor))) not in used] for node, edges in corridors.items()}
    network_nodes = selected.keys()
    candidates = []
    for start in sorted(network_nodes):
        if not unused[start]:
            continue
        distances, previous = shortest_paths(unused, start, terminals=network_nodes)
        main_distances, main_previous = shortest_paths(selected, start)
        for end in network_nodes:
            length = distances.get(end, 0)
            main_length = main_distances.get(end, 0)
            if end <= start or not (10 <= length <= 64 and 10 <= main_length <= 75 and length <= main_length * 1.7):
                continue
            branch = trace_path(previous, start, end)
            main = trace_path(main_previous, start, end)
            loop = Polygon([points[node] for node in branch + main[-2:0:-1]])
            if loop.is_valid and loop.area >= 30:
                score = min(loop.area, 300) / (1 + loop.centroid.distance(center) / 32)
                candidates.append((score, branch))

    chosen = set()
    count = 0
    for _, branch in sorted(candidates, key=lambda item: -item[0]):
        edges = path_edges(branch)
        if not chosen.isdisjoint(edges):
            continue
        chosen.update(edges)
        yield branch
        count += 1
        if count == 2:
            break


def circulation_routes(points, graph, entrances, transfers, slab, solids):
    if not points:
        return []
    corridors = public_corridors(points, graph, slab, solids)
    if not corridors:
        return []

    def nearest_nodes(positions):
        result = set()
        for point in positions:
            node = min(corridors, key=lambda candidate: dist(point, points[candidate]))
            if dist(point, points[node]) < 10:
                result.add(node)
        return result

    doors = nearest_nodes(entrances)
    landmarks = doors | nearest_nodes(transfers)

    # Include separated intersections so cross aisles can connect even without a nearby door.
    junctions = sorted((node for node, edges in corridors.items() if len(edges) >= 3),
                       key=lambda node: (-len(corridors[node]), node))
    added = 0
    for node in junctions:
        if all(dist(points[node], points[landmark]) >= 16 for landmark in landmarks):
            landmarks.add(node)
            added += 1
            if added == 8:
                break

    ordered = sorted(landmarks)
    candidates = []
    for index, start in enumerate(ordered):
        distances, previous = shortest_paths(corridors, start)
        for end in ordered[index + 1:]:
            if end in distances:
                candidates.append((distances[end], start, end, previous))

    selected = defaultdict(list)
    used = set()

    def add_path(path):
        for start, end in zip(path, path[1:]):
            edge = tuple(sorted((start, end)))
            if edge not in used:
                distance = dist(points[start], points[end])
                selected[start].append((end, distance))
                selected[end].append((start, distance))
                used.add(edge)

    for length, start, end, previous in sorted(candidates, key=lambda item: item[:3]):
        current, _ = shortest_paths(selected, start, end)
        if current.get(end, float("inf")) <= length * 1.38 + 5:
            continue
        add_path(trace_path(previous, start, end))

    for branch in corridor_loops(points, corridors, selected, used, slab.centroid):
        add_path(branch)
    phase_distances = {}
    for root in sorted(doors.intersection(selected)) + sorted(selected):
        if root not in phase_distances:
            distances, _ = shortest_paths(selected, root)
            phase_distances.update(distances)
    return list(corridor_chains(selected, points, phase_distances))
