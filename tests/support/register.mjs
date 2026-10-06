// `npm test` imports this first (see package.json), so tests may load route modules; see hooks.mjs.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
