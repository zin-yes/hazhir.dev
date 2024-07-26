import WorkerUrlPlugin from "worker-url/plugin.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, options) => {
    config.plugins.push(new WorkerUrlPlugin());
    config.resolve.alias = {
      ...config.resolve.alias,
      os: false,
      child_process: false,
      worker_threads: false,
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },
};

export default nextConfig;
