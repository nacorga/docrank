// The examples are repositories of their own, tested with `node --test` inside
// the demo they build; vitest would collect their tests as the plugin's.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({ test: { exclude: [...configDefaults.exclude, "examples/**"] } });
