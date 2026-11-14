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
};

export default nextConfig;



