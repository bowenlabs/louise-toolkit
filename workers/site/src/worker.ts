// Worker entrypoint. @astrojs/cloudflare v14 dropped `workerEntryPoint`, so
// `wrangler.jsonc`'s `main` points here; this hands every request to Astro's
// SSR handler. It's also the seam where a custom `queue`/`scheduled` handler
// would be composed in later.
import { handle } from "@astrojs/cloudflare/handler";

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
