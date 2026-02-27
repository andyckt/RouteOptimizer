import type { DeliveryCustomer } from "@/types/delivery-run";
import { validationError } from "@/lib/http/errors";

/**
 * Block save if any customer has geocode_status="failed" and nearby_address_override is empty.
 */
export function assertSaveGate(customers: DeliveryCustomer[]): void {
  const failed = customers.find(
    (c) =>
      c.geocode_status === "failed" &&
      !(c.nearby_address_override?.trim())
  );
  if (failed) {
    throw validationError(
      `Customer "${failed.name}" has a failed geocode. Add a nearby address override or fix the address before saving.`
    );
  }
}
