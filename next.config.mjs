import { networkInterfaces } from "node:os";

const lanOrigins = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter(({ family, internal }) => family === "IPv4" && !internal)
  .map(({ address }) => address);

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  allowedDevOrigins: lanOrigins,
  reactCompiler: true,
  async headers() {
    return [{ source: '/sw.js', headers: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Service-Worker-Allowed', value: '/' },
    ] }];
  },
};

export default nextConfig;



