import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudscape (AWS's design system) ships ESM with CSS imports.
  transpilePackages: [
    "@cloudscape-design/components",
    "@cloudscape-design/component-toolkit",
    "@cloudscape-design/collection-hooks",
  ],
};

export default nextConfig;
