import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
