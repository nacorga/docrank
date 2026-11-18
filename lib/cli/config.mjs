/**
 * `docrank config`: the resolved configuration as JSON, defaults filled in, or
 * the loader's errors and exit 1. What `init` runs to prove a file it wrote.
 */
import { loadConfig } from "../config.mjs";

export default function config() {
  return JSON.stringify(loadConfig(), null, 2);
}
