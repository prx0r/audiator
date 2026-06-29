/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['sherpa-onnx-node'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sherpa-onnx-node');
    }
    return config;
  },
};

module.exports = nextConfig;
