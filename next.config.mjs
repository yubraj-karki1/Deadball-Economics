import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
export default function nextConfig(phase) {
  return {
    // Next 15 writes development and production bundles to the same directory
    // by default. Keeping them separate prevents Webpack manifest corruption
    // when a validation build runs while the dev server is open.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
