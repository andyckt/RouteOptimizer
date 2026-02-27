"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { DeliveryRun } from "@/types/delivery-run";
import { decodePolyline } from "@/lib/maps/polyline";

type LatLng = { lat: number; lng: number };

const ROUTE_LINE = {
  weight: 5,
  color: "#0ea5e9",
  opacity: 0.95,
};
const ROUTE_SHADOW = {
  weight: 12,
  color: "#1e293b",
  opacity: 0.2,
};

function startIcon(): L.DivIcon {
  return L.divIcon({
    className: "route-map-start-marker",
    html: `<div style="
      background:linear-gradient(135deg,#10b981 0%,#059669 100%);
      color:#fff;
      border-radius:9999px;
      width:32px;
      height:32px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      border:3px solid #fff;
      box-shadow:0 4px 12px rgba(0,0,0,0.25);
    ">S</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function numberedIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: "route-map-numbered-marker",
    html: `<div style="
      background:linear-gradient(145deg,#3b82f6 0%,#2563eb 100%);
      color:#fff;
      border-radius:9999px;
      width:28px;
      height:28px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:12px;
      font-weight:700;
      border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);
    ">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function getCustomerCoords(run: DeliveryRun, customerIndex: number): LatLng | null {
  const customer = run.customers[customerIndex];
  if (!customer) return null;
  if (
    customer.geocode_status === "override_success" &&
    typeof customer.nearby_lat === "number" &&
    typeof customer.nearby_lng === "number"
  ) {
    return { lat: customer.nearby_lat, lng: customer.nearby_lng };
  }
  if (typeof customer.lat === "number" && typeof customer.lng === "number") {
    return { lat: customer.lat, lng: customer.lng };
  }
  return null;
}

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), {
        padding: [40, 40],
      });
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
    }
  }, [map, points]);
  return null;
}

function RouteMapComponent({ run }: { run: DeliveryRun }) {
  const stops = run.optimized_route?.stops ?? [];
  const stopPoints = stops
    .map((stop) => getCustomerCoords(run, stop.customer_index))
    .filter((v): v is LatLng => Boolean(v));

  const routePoints = run.optimized_route?.encoded_polyline
    ? decodePolyline(run.optimized_route.encoded_polyline)
    : [];

  const startCoords = run.optimized_route;
  const startPoint: LatLng | null =
    typeof startCoords?.start_lat === "number" &&
    typeof startCoords?.start_lng === "number"
      ? { lat: startCoords.start_lat, lng: startCoords.start_lng }
      : null;

  // Use road-following polyline when available; otherwise connect stops with straight lines
  const baseLinePoints =
    routePoints.length > 1
      ? routePoints
      : stopPoints.length >= 1
        ? stopPoints
        : [];

  // Prepend start location so the route line connects depot -> first stop -> ...
  const linePoints =
    startPoint && baseLinePoints.length > 0
      ? [startPoint, ...baseLinePoints]
      : baseLinePoints;

  const fitPoints =
    startPoint && (stopPoints.length > 0 || routePoints.length > 0)
      ? [startPoint, ...(linePoints.length > 1 ? linePoints : stopPoints)]
      : startPoint
        ? [startPoint]
        : stopPoints.length > 0
          ? stopPoints
          : routePoints.length > 0
            ? routePoints
            : [];

  if (fitPoints.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-sm text-gray-500 bg-gray-50">
        No map points available yet.
      </div>
    );
  }

  return (
    <div className="h-[420px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <MapContainer
        center={[fitPoints[0].lat, fitPoints[0].lng]}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        {linePoints.length > 1 && (
          <>
            <Polyline
              positions={linePoints.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={ROUTE_SHADOW}
            />
            <Polyline
              positions={linePoints.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={ROUTE_LINE}
            />
          </>
        )}
        {startPoint && (
          <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon()}>
            <Popup>Start</Popup>
          </Marker>
        )}
        {stops.map((stop, i) => {
          const point = getCustomerCoords(run, stop.customer_index);
          if (!point) return null;
          return (
            <Marker
              key={`${stop.customer_index}-${i}`}
              position={[point.lat, point.lng]}
              icon={numberedIcon(i + 1)}
            >
              <Popup>
                Stop {i + 1}: {stop.customer_name}
              </Popup>
            </Marker>
          );
        })}
        <FitBounds points={fitPoints} />
      </MapContainer>
    </div>
  );
}

export { RouteMapComponent as RouteMap };
export default RouteMapComponent;

