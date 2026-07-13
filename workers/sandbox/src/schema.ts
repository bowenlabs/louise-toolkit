import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Demo orders written by the sandbox checkout. Holds only what the confirmation
// screen + email need; wiped nightly by the worker's scheduled() reset so the
// sandbox never accumulates strangers' email addresses.
export const demoOrders = sqliteTable("demo_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  paymentId: text("payment_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});
