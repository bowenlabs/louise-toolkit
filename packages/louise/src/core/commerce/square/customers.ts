// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: customers.

import type { SquareConfig } from "./client.js";
import { sqGet, sqPost, sqPut } from "./request.js";

export interface SquareCustomer {
  id: string;
  email: string | null;
  givenName: string | null;
  familyName: string | null;
  phoneNumber: string | null;
}

interface RawCustomer {
  id?: string;
  email_address?: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
}

function mapCustomer(c: RawCustomer): SquareCustomer {
  return {
    id: c.id ?? "",
    email: c.email_address ?? null,
    givenName: c.given_name ?? null,
    familyName: c.family_name ?? null,
    phoneNumber: c.phone_number ?? null,
  };
}

/** Find customers by exact email. POST /v2/customers/search. */
export async function searchCustomersByEmail(
  config: SquareConfig,
  email: string,
): Promise<SquareCustomer[]> {
  const res = await sqPost<{ customers?: RawCustomer[] }>(config, "/v2/customers/search", {
    query: { filter: { email_address: { exact: email } } },
    limit: 1,
  });
  return (res.customers ?? []).map(mapCustomer);
}

/** Retrieve one customer. GET /v2/customers/{id}. */
export async function retrieveCustomer(
  config: SquareConfig,
  customerId: string,
): Promise<SquareCustomer> {
  const res = await sqGet<{ customer?: RawCustomer }>(
    config,
    `/v2/customers/${encodeURIComponent(customerId)}`,
  );
  if (!res.customer) throw new Error(`Square customer ${customerId} not found`);
  return mapCustomer(res.customer);
}

/** Create a customer. POST /v2/customers. */
export async function createCustomer(
  config: SquareConfig,
  input: { email: string; givenName?: string; familyName?: string; phoneNumber?: string },
): Promise<SquareCustomer> {
  const res = await sqPost<{ customer?: RawCustomer }>(config, "/v2/customers", {
    email_address: input.email,
    given_name: input.givenName,
    family_name: input.familyName,
    phone_number: input.phoneNumber,
  });
  if (!res.customer) throw new Error("Square customer creation returned no customer");
  return mapCustomer(res.customer);
}

/**
 * Find-or-create a Square customer by email—used to (optionally) link a site
 * account to Square. Returns the customer and whether it was created. The
 * names and phone apply only when creating; to change a customer that already
 * exists, use {@link updateCustomer}.
 */
export async function ensureCustomer(
  config: SquareConfig,
  input: { email: string; givenName?: string; familyName?: string; phoneNumber?: string },
): Promise<{ customer: SquareCustomer; created: boolean }> {
  const existing = await searchCustomersByEmail(config, input.email);
  if (existing[0]) return { customer: existing[0], created: false };
  return { customer: await createCustomer(config, input), created: true };
}

/**
 * Change fields on an existing customer. PUT /v2/customers/{id}. Sparse: only
 * the fields you pass are sent, so an omitted one is left as it is—pass
 * `null` to clear it.
 */
export async function updateCustomer(
  config: SquareConfig,
  customerId: string,
  input: {
    email?: string | null;
    givenName?: string | null;
    familyName?: string | null;
    phoneNumber?: string | null;
  },
): Promise<SquareCustomer> {
  const body: Record<string, string | null> = {};
  if (input.email !== undefined) body.email_address = input.email;
  if (input.givenName !== undefined) body.given_name = input.givenName;
  if (input.familyName !== undefined) body.family_name = input.familyName;
  if (input.phoneNumber !== undefined) body.phone_number = input.phoneNumber;
  const res = await sqPut<{ customer?: RawCustomer }>(
    config,
    `/v2/customers/${encodeURIComponent(customerId)}`,
    body,
  );
  if (!res.customer) throw new Error("Square customer update returned no customer");
  return mapCustomer(res.customer);
}
