import { __resetEnvCache } from "@/lib/env";
// env() caches the parsed environment; tests that flip env vars must clear the cache.
export const resetEnvForTests = () => __resetEnvCache();
