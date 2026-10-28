import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  // The playground is a static Vite build copied into public/play (see scripts/copy-playground.mjs).
  async rewrites() {
    return [{ source: "/play", destination: "/play/index.html" }];
  },
};

export default withMDX(config);
