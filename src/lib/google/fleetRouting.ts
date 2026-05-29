import crypto from "crypto";
import { getServerEnv } from "@/lib/env";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FleetLatLng {
  latitude: number;
  longitude: number;
}

export interface FleetShipmentInput {
  label: string;
  location: FleetLatLng;
  /** Service time at stop in seconds. Defaults to 300 (5 min) when omitted. */
  serviceTimeSeconds?: number;
}

export interface FleetVehicleInput {
  startLocation: FleetLatLng;
  endLocation?: FleetLatLng;
  travelMode: "DRIVING" | "BICYCLING";
}

interface FleetOptimizeRequest {
  model: {
    globalStartTime: string;
    globalEndTime: string;
    shipments: Array<{
      label: string;
      deliveries: Array<{
        arrivalWaypoint: {
          location: {
            latLng: FleetLatLng;
          };
        };
        duration: string;
      }>;
    }>;
    vehicles: Array<{
      startWaypoint: {
        location: {
          latLng: FleetLatLng;
        };
      };
      endWaypoint?: {
        location: {
          latLng: FleetLatLng;
        };
      };
      travelMode: "DRIVING" | "BICYCLING";
      costPerKilometer: number;
      costPerHour: number;
    }>;
  };
  searchMode: "RETURN_FAST";
  solvingMode: "DEFAULT_SOLVE";
}

export interface FleetVisit {
  shipmentIndex: number;
  shipmentLabel?: string;
  startTime?: string;
  detour?: string;
}

export interface FleetTransition {
  travelDistanceMeters?: number;
  travelDuration?: string;
}

export interface FleetOptimizeResult {
  routes: Array<{
    visits?: FleetVisit[];
    transitions?: FleetTransition[];
    routePolyline?: {
      points?: string;
    };
  }>;
  metrics?: unknown;
  totalCost?: number;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function parseServiceAccount(): ServiceAccount {
  const { GOOGLE_SERVICE_ACCOUNT_JSON } = getServerEnv();
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    const hint = GOOGLE_SERVICE_ACCOUNT_JSON.trimStart().startsWith("{")
      ? ""
      : " The value must be valid JSON starting with {. Check that .env has the full JSON (no extra quotes, no missing brace).";
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON invalid: ${msg}.${hint}`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields (client_email, private_key)");
  }
  return parsed;
}

async function mintAccessToken(scope: string): Promise<string> {
  const sa = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Failed to mint Google OAuth token");
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google OAuth token response missing access_token");
  }
  return data.access_token as string;
}

export async function optimizeTours(input: {
  globalStartTime: string;
  globalEndTime: string;
  shipments: FleetShipmentInput[];
  vehicle: FleetVehicleInput;
}): Promise<FleetOptimizeResult> {
  const { GOOGLE_CLOUD_PROJECT_ID } = getServerEnv();
  const accessToken = await mintAccessToken(
    "https://www.googleapis.com/auth/cloud-platform"
  );

  const body: FleetOptimizeRequest = {
    model: {
      globalStartTime: input.globalStartTime,
      globalEndTime: input.globalEndTime,
      shipments: input.shipments.map((shipment) => ({
        label: shipment.label,
        deliveries: [
          {
            arrivalWaypoint: {
              location: {
                latLng: shipment.location,
              },
            },
            duration: `${shipment.serviceTimeSeconds ?? 300}s`,
          },
        ],
      })),
      vehicles: [
        {
          startWaypoint: {
            location: { latLng: input.vehicle.startLocation },
          },
          endWaypoint: input.vehicle.endLocation
            ? {
                location: { latLng: input.vehicle.endLocation },
              }
            : undefined,
          travelMode: input.vehicle.travelMode,
          costPerKilometer: 1,
          costPerHour: 60,
        },
      ],
    },
    searchMode: "RETURN_FAST",
    solvingMode: "DEFAULT_SOLVE",
  };

  const res = await fetch(
    `https://routeoptimization.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT_ID}:optimizeTours`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Goog-User-Project": GOOGLE_CLOUD_PROJECT_ID,
        "X-Goog-FieldMask":
          "routes,metrics,totalCost,routes.visits.shipmentIndex,routes.visits.shipmentLabel,routes.visits.startTime,routes.visits.detour,routes.transitions.travelDistanceMeters,routes.transitions.travelDuration,routes.routePolyline.points",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fleet optimizeTours failed: ${text}`);
  }
  return (await res.json()) as FleetOptimizeResult;
}

