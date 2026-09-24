// ADR 0001, layer 1—the typed source of truth for the editable page fields.
// One Zod definition; `z.infer` gives the type used by BOTH the `savePage`
// Action (server, src/actions) and the Solid island that calls it (client,
// src/islands). No hand-written interface, no manual coercion—types flow from
// this schema, not from the transport.
//
// Zod is a first-class dependency now (ADR 0001—Zod as the default schema
// layer); the schema drops straight into `defineAction({ input })`.
import { z } from "zod";

export const pageEditInput = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1, "Title is required"),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export type PageEditInput = z.infer<typeof pageEditInput>;
