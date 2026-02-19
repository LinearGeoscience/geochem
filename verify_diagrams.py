"""
Verification Script for Classification Diagrams
=================================================
Renders all diagrams from classificationDiagrams.json as B&W PNG images
for visual review. Handles both ternary and XY diagram types.
"""

import json
import math
from pathlib import Path

import plotly.graph_objects as go
from plotly.subplots import make_subplots


# Ternary coordinate conversions (matching frontend classificationDiagram.ts)
TERNARY_HEIGHT = 86.60254037844387  # 100 * sqrt(3) / 2


def xml_cartesian_to_ternary(x: float, y: float) -> dict:
    """Convert XML Cartesian coordinates to ternary (a, b, c) percentages."""
    a_pct = (y / TERNARY_HEIGHT) * 100
    remainder = 100 - a_pct

    if remainder <= 0.001:
        return {"a": a_pct, "b": 0, "c": 0}

    y_ratio = y / TERNARY_HEIGHT
    x_min = 50 * y_ratio
    x_max = 100 - 50 * y_ratio
    x_range = x_max - x_min

    if x_range <= 0.001:
        return {"a": a_pct, "b": 0, "c": 0}

    x_normalized = (x - x_min) / x_range
    c_pct = remainder * x_normalized
    b_pct = remainder - c_pct

    return {"a": a_pct, "b": b_pct, "c": c_pct}


def render_ternary_diagram(diagram: dict, output_path: Path):
    """Render a ternary diagram as B&W PNG."""
    fig = go.Figure()

    # Process polygons
    for poly in diagram.get("polygons", []):
        points = poly.get("points", [])
        if not points:
            continue

        is_open = poly.get("closed") is False

        # Convert to ternary
        ternary_pts = [xml_cartesian_to_ternary(p["x"], p["y"]) for p in points]

        # Close if needed
        pts = list(ternary_pts)
        if not is_open and (pts[0]["a"] != pts[-1]["a"] or pts[0]["b"] != pts[-1]["b"]):
            pts.append(pts[0])

        fig.add_trace(go.Scatterternary(
            a=[p["a"] for p in pts],
            b=[p["b"] for p in pts],
            c=[p["c"] for p in pts],
            mode="lines",
            line=dict(color="black", width=1),
            fill="none",
            name=poly["name"],
            showlegend=False,
            hoverinfo="name"
        ))

        # Label
        if poly["name"]:
            # Use centroid for label position
            avg_a = sum(p["a"] for p in ternary_pts) / len(ternary_pts)
            avg_b = sum(p["b"] for p in ternary_pts) / len(ternary_pts)
            avg_c = sum(p["c"] for p in ternary_pts) / len(ternary_pts)

            fig.add_trace(go.Scatterternary(
                a=[avg_a],
                b=[avg_b],
                c=[avg_c],
                mode="text",
                text=[poly["name"]],
                textfont=dict(size=6, color="black"),
                showlegend=False,
                hoverinfo="skip"
            ))

    # Render ternary point features
    for pf in diagram.get("pointFeatures", []):
        if "a" not in pf or "b" not in pf:
            continue
        c_val = max(0, 1 - pf["a"] - pf["b"])
        fig.add_trace(go.Scatterternary(
            a=[pf["a"] * 100],
            b=[pf["b"] * 100],
            c=[c_val * 100],
            mode="markers+text" if pf.get("name") else "markers",
            text=[pf["name"]] if pf.get("name") else None,
            textposition="top center",
            textfont=dict(size=6, color="black"),
            marker=dict(size=max(pf.get("pixelRadius", 5), 4), color="black"),
            showlegend=False,
            hoverinfo="skip"
        ))

    # Render ternary labels
    for lbl in diagram.get("labels", []):
        if "a" not in lbl or "b" not in lbl:
            continue
        c_val = max(0, 1 - lbl["a"] - lbl["b"])
        fig.add_trace(go.Scatterternary(
            a=[lbl["a"] * 100],
            b=[lbl["b"] * 100],
            c=[c_val * 100],
            mode="text",
            text=[lbl["name"]],
            textfont=dict(size=7, color="black"),
            showlegend=False,
            hoverinfo="skip"
        ))

    # Layout
    axes = diagram.get("axes", {})
    fig.update_layout(
        title=dict(text=diagram["name"], x=0.5, font=dict(size=12)),
        ternary=dict(
            sum=100,
            aaxis=dict(title=axes.get("a", {}).get("name", "A"), linewidth=2, linecolor="black"),
            baxis=dict(title=axes.get("b", {}).get("name", "B"), linewidth=2, linecolor="black"),
            caxis=dict(title=axes.get("c", {}).get("name", "C"), linewidth=2, linecolor="black"),
            bgcolor="white"
        ),
        paper_bgcolor="white",
        showlegend=False,
        width=700,
        height=600,
        margin=dict(l=60, r=60, t=60, b=60)
    )

    fig.write_image(str(output_path), scale=2)


def render_xy_diagram(diagram: dict, output_path: Path):
    """Render an XY diagram as B&W PNG."""
    fig = go.Figure()

    axes = diagram.get("axes", {})
    x_is_log = axes.get("x", {}).get("log", False)
    y_is_log = axes.get("y", {}).get("log", False)

    # Find bounds
    bounds = diagram.get("bounds")
    if bounds:
        x_min, y_min = bounds["x"], bounds["y"]
        x_max, y_max = bounds["x"] + bounds["w"], bounds["y"] + bounds["h"]
    else:
        x_min = y_min = float("inf")
        x_max = y_max = float("-inf")
        for poly in diagram.get("polygons", []):
            for p in poly.get("points", []):
                x_min = min(x_min, p["x"])
                x_max = max(x_max, p["x"])
                y_min = min(y_min, p["y"])
                y_max = max(y_max, p["y"])

    # Process polygons
    for poly in diagram.get("polygons", []):
        points = poly.get("points", [])
        if not points:
            continue

        is_open = poly.get("closed") is False
        pts = list(points)
        if not is_open and (pts[0]["x"] != pts[-1]["x"] or pts[0]["y"] != pts[-1]["y"]):
            pts.append(pts[0])

        fig.add_trace(go.Scatter(
            x=[p["x"] for p in pts],
            y=[p["y"] for p in pts],
            mode="lines",
            line=dict(color="black", width=1),
            fill="none",
            name=poly["name"],
            showlegend=False,
            hoverinfo="name"
        ))

        # Label
        if poly["name"] and poly.get("labelPos"):
            lp = poly["labelPos"]
            lx = lp.get("x", sum(p["x"] for p in points) / len(points))
            ly = lp.get("y", sum(p["y"] for p in points) / len(points))
            fig.add_trace(go.Scatter(
                x=[lx],
                y=[ly],
                mode="text",
                text=[poly["name"]],
                textfont=dict(size=6, color="black"),
                showlegend=False,
                hoverinfo="skip"
            ))

    # Render lines (y = mx + c)
    for line in diagram.get("lines", []):
        line_xs = [x_min, x_max]
        line_ys = [line["slope"] * x + line["intercept"] for x in line_xs]
        fig.add_trace(go.Scatter(
            x=line_xs,
            y=line_ys,
            mode="lines",
            line=dict(color="gray", width=1.5, dash="dash"),
            name=line.get("name", ""),
            showlegend=False,
            hoverinfo="skip"
        ))
        if line.get("name"):
            mid_x = (x_min + x_max) / 2
            mid_y = line["slope"] * mid_x + line["intercept"]
            fig.add_trace(go.Scatter(
                x=[mid_x],
                y=[mid_y],
                mode="text",
                text=[line["name"]],
                textfont=dict(size=7, color="gray"),
                showlegend=False,
                hoverinfo="skip"
            ))

    # Render point features
    for pf in diagram.get("pointFeatures", []):
        if "x" not in pf or "y" not in pf:
            continue
        fig.add_trace(go.Scatter(
            x=[pf["x"]],
            y=[pf["y"]],
            mode="markers+text" if pf.get("name") else "markers",
            text=[pf["name"]] if pf.get("name") else None,
            textposition="top center",
            textfont=dict(size=6, color="black"),
            marker=dict(size=max(pf.get("pixelRadius", 5), 4), color="black"),
            showlegend=False,
            hoverinfo="skip"
        ))

    # Render labels
    for lbl in diagram.get("labels", []):
        if "x" not in lbl or "y" not in lbl:
            continue
        fig.add_trace(go.Scatter(
            x=[lbl["x"]],
            y=[lbl["y"]],
            mode="text",
            text=[lbl["name"]],
            textfont=dict(size=7, color="black"),
            showlegend=False,
            hoverinfo="skip"
        ))

    # Layout
    x_range_pad = (x_max - x_min) * 0.05
    y_range_pad = (y_max - y_min) * 0.05

    x_axis_config = dict(
        title=axes.get("x", {}).get("name", "X"),
        linewidth=2,
        linecolor="black",
        showline=True,
        mirror=True,
        showgrid=True,
        gridcolor="rgba(0,0,0,0.1)"
    )
    y_axis_config = dict(
        title=axes.get("y", {}).get("name", "Y"),
        linewidth=2,
        linecolor="black",
        showline=True,
        mirror=True,
        showgrid=True,
        gridcolor="rgba(0,0,0,0.1)"
    )

    if x_is_log:
        x_axis_config["type"] = "log"
        if x_min > 0:
            x_axis_config["range"] = [math.log10(max(x_min, 0.001)), math.log10(max(x_max, 0.01))]
    else:
        x_axis_config["range"] = [x_min - x_range_pad, x_max + x_range_pad]

    if y_is_log:
        y_axis_config["type"] = "log"
        if y_min > 0:
            y_axis_config["range"] = [math.log10(max(y_min, 0.001)), math.log10(max(y_max, 0.01))]
    else:
        y_axis_config["range"] = [y_min - y_range_pad, y_max + y_range_pad]

    fig.update_layout(
        title=dict(text=diagram["name"], x=0.5, font=dict(size=12)),
        xaxis=x_axis_config,
        yaxis=y_axis_config,
        paper_bgcolor="white",
        plot_bgcolor="white",
        showlegend=False,
        width=800,
        height=600,
        margin=dict(l=70, r=40, t=60, b=70)
    )

    fig.write_image(str(output_path), scale=2)


def main():
    base_dir = Path(r"C:\Users\harry\OneDrive\2 - Work\Linear Geoscience\Final Code\LargeProjects\Geochem")
    json_path = base_dir / "frontend" / "src" / "data" / "classificationDiagrams.json"
    output_dir = base_dir / "diagram_review"
    output_dir.mkdir(exist_ok=True)

    print(f"Loading diagrams from {json_path}...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    diagrams = data["diagrams"]
    print(f"Found {len(diagrams)} diagrams")
    print()

    success = 0
    errors = []

    for i, diagram in enumerate(diagrams):
        diag_id = diagram["id"]
        diag_type = diagram["type"]
        name = diagram["name"]
        filename = f"{diag_id}.png"
        output_path = output_dir / filename

        print(f"[{i+1}/{len(diagrams)}] {name} ({diag_type})")

        try:
            if diag_type == "ternary":
                render_ternary_diagram(diagram, output_path)
            elif diag_type == "xy":
                render_xy_diagram(diagram, output_path)
            else:
                print(f"  Unknown type: {diag_type}, skipping")
                continue

            success += 1
        except Exception as e:
            errors.append((diag_id, name, str(e)))
            print(f"  ERROR: {e}")

    print()
    print(f"Rendered {success}/{len(diagrams)} diagrams")
    print(f"Output: {output_dir}")

    if errors:
        print(f"\n{len(errors)} errors:")
        for diag_id, name, err in errors:
            print(f"  {diag_id}: {name} - {err}")


if __name__ == "__main__":
    main()
