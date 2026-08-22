import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // WT-3: pdfjs-dist + tesseract.js are heavy ESM/native-ish libs that must be
  // required at runtime (node_modules), not bundled by the Next compiler.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
