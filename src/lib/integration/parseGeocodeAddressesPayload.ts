import type { ValidationIssue } from "@/lib/integration/buildRunIntegrationResponse";

export const MAX_GEOCODE_ADDRESSES = 50;

export interface IncomingGeocodeAddress {
  client_ref?: unknown;
  address?: unknown;
  area?: unknown;
  country?: unknown;
}

export interface IncomingGeocodeBody {
  created_by_integration?: unknown;
  idempotency_key?: unknown;
  addresses?: unknown;
}

export interface ParsedGeocodeAddress {
  client_ref: string;
  address: string;
  area?: string;
  country?: string;
}

export interface ParsedGeocodePayload {
  created_by_integration?: string;
  idempotency_key?: string;
  addresses: ParsedGeocodeAddress[];
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseGeocodeAddressesPayload(
  body: unknown
): { errors: ValidationIssue[]; payload?: ParsedGeocodePayload } {
  const errors: ValidationIssue[] = [];

  if (!body || typeof body !== "object") {
    return {
      errors: [{ field: "body", message: "Request body must be a JSON object." }],
    };
  }

  const raw = body as IncomingGeocodeBody;
  const addressesRaw = raw.addresses;

  if (!Array.isArray(addressesRaw)) {
    errors.push({
      field: "addresses",
      message: "addresses is required and must be a non-empty array.",
    });
    return { errors };
  }

  if (addressesRaw.length === 0) {
    errors.push({
      field: "addresses",
      message: "addresses must contain at least one item.",
    });
    return { errors };
  }

  if (addressesRaw.length > MAX_GEOCODE_ADDRESSES) {
    errors.push({
      field: "addresses",
      message: `At most ${MAX_GEOCODE_ADDRESSES} addresses are allowed per request.`,
    });
    return { errors };
  }

  const parsedAddresses: ParsedGeocodeAddress[] = [];
  const seenRefs = new Set<string>();

  for (let i = 0; i < addressesRaw.length; i++) {
    const item = addressesRaw[i];
    if (!item || typeof item !== "object") {
      errors.push({
        field: `addresses[${i}]`,
        message: "Each address entry must be an object.",
      });
      continue;
    }

    const row = item as IncomingGeocodeAddress;
    const clientRef = asTrimmedString(row.client_ref);
    const address = asTrimmedString(row.address);

    if (!clientRef) {
      errors.push({
        field: `addresses[${i}].client_ref`,
        message: "client_ref is required.",
      });
    } else if (seenRefs.has(clientRef)) {
      errors.push({
        field: `addresses[${i}].client_ref`,
        message: `Duplicate client_ref: ${clientRef}`,
      });
    } else {
      seenRefs.add(clientRef);
    }

    if (!address) {
      errors.push({
        field: `addresses[${i}].address`,
        message: "address is required.",
      });
    }

    if (errors.some((e) => e.field?.startsWith(`addresses[${i}]`))) continue;

    const area = asTrimmedString(row.area);
    const country = asTrimmedString(row.country);
    parsedAddresses.push({
      client_ref: clientRef,
      address,
      ...(area ? { area } : {}),
      ...(country ? { country } : {}),
    });
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    payload: {
      ...(asTrimmedString(raw.created_by_integration)
        ? { created_by_integration: asTrimmedString(raw.created_by_integration) }
        : {}),
      ...(asTrimmedString(raw.idempotency_key)
        ? { idempotency_key: asTrimmedString(raw.idempotency_key) }
        : {}),
      addresses: parsedAddresses,
    },
  };
}
