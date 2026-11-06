import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl } from "../lib/maplibre";
import type { Feature, Polygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Extent } from "../types";

interface Props {
  extent: Extent;
  label: string;
}

export default function ExtentMap({ extent, label }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const map = new MapLibreMap({
      container: element,
      style: "https://tiles.openfreemap.org/styles/liberty",
      bounds: [
        [extent.west, extent.south],
        [extent.east, extent.north],
      ],
      fitBoundsOptions: { padding: 40 },
    });
    map.addControl(new NavigationControl(), "top-right");
    map.on("load", () => {
      const feature: Feature<Polygon> = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [extent.west, extent.south],
              [extent.east, extent.south],
              [extent.east, extent.north],
              [extent.west, extent.north],
              [extent.west, extent.south],
            ],
          ],
        },
      };
      map.addSource("dataset-extent", { type: "geojson", data: feature });
      map.addLayer({
        id: "dataset-extent-fill",
        type: "fill",
        source: "dataset-extent",
        paint: { "fill-color": "#2d6a4f", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "dataset-extent-outline",
        type: "line",
        source: "dataset-extent",
        paint: { "line-color": "#2d6a4f", "line-width": 2 },
      });
    });
    return () => map.remove();
  }, [extent]);

  return (
    <div
      ref={container}
      className="h-96 w-full overflow-hidden rounded-box border border-base-300"
      style={{ height: "24rem" }}
      aria-label={label}
    />
  );
}
