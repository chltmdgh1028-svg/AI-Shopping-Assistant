import type { NextConfig } from "next";

// Product images from shop pages are rendered as plain <img> (see ProductVisual), and the brand
// photography is local, so next/image needs no remote host allow-list.
const nextConfig: NextConfig = {};

export default nextConfig;
