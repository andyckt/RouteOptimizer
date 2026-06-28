import type { DeliveryCustomer } from "@/types/delivery-run";
import { normalizeOrderIds } from "@/lib/normalization/delivery-run";
import {
  fetchOrderBoxCounts,
  getKapiooAdminConfigFromEnv,
} from "@/lib/kapioo/admin-client";

function uniqueOrderIds(customers: DeliveryCustomer[]) {
  const ids = new Set<string>();
  for (const customer of customers) {
    for (const orderId of normalizeOrderIds(customer.order_ids) ?? []) {
      ids.add(orderId);
    }
  }
  return Array.from(ids);
}

export async function enrichCustomersWithBoxCounts(customers: DeliveryCustomer[]) {
  const orderIds = uniqueOrderIds(customers);
  if (orderIds.length === 0) return customers;

  const counts = await fetchOrderBoxCounts(getKapiooAdminConfigFromEnv(), orderIds);
  if (!counts) return customers;

  for (const customer of customers) {
    const customerOrderIds = normalizeOrderIds(customer.order_ids) ?? [];
    const boxCount = customerOrderIds.reduce((total, orderId) => {
      return total + (counts[orderId] ?? 0);
    }, 0);

    if (boxCount > 0) {
      customer.box_count = boxCount;
    } else {
      delete customer.box_count;
    }
  }

  return customers;
}
