import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config();

interface Config {
  // Server
  nodeEnv: string;
  port: number;

  // Domain
  domain: string;

  // Authentication
  apiKey: string;

  // AWS
  awsRegion: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;

  // Docker
  dockerSocket: string;
  ideContainerImage: string;

  // Resource Limits
  maxMemoryPercent: number;
  maxCpuPercent: number;
  containerCpuLimit: number;
  containerMemoryLimit: number;

  // Database
  databasePath: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvVarOptional(
  key: string,
  defaultValue?: string
): string | undefined {
  return process.env[key] || defaultValue;
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable ${key}: ${value}`);
  }
  return parsed;
}

const config: Config = {
  // Server
  nodeEnv: getEnvVar("NODE_ENV", "development"),
  port: getEnvVarNumber("PORT", 3001),

  // Domain
  domain: getEnvVar("DOMAIN"),

  // Authentication (supports multiple keys separated by commas)
  apiKey: getEnvVar("API_KEY"),

  // AWS
  awsRegion: getEnvVar("AWS_REGION", "us-east-1"),
  awsAccessKeyId: getEnvVarOptional("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: getEnvVarOptional("AWS_SECRET_ACCESS_KEY"),

  // Docker
  dockerSocket: getEnvVar(
    "DOCKER_SOCKET",
    process.platform === "darwin"
      ? `${process.env.HOME}/.docker/run/docker.sock`
      : "/var/run/docker.sock"
  ),
  ideContainerImage: getEnvVar(
    "IDE_CONTAINER_IMAGE",
    "classla-ide-container:latest"
  ),

  // Resource Limits
  maxMemoryPercent: getEnvVarNumber("MAX_MEMORY_PERCENT", 90),
  maxCpuPercent: getEnvVarNumber("MAX_CPU_PERCENT", 90),
  containerCpuLimit: getEnvVarNumber("CONTAINER_CPU_LIMIT", 2),
  containerMemoryLimit: getEnvVarNumber("CONTAINER_MEMORY_LIMIT", 4294967296), // 4GB

  // Database
  databasePath: getEnvVar(
    "DATABASE_PATH",
    path.join(process.cwd(), "data", "containers.sqlite")
  ),
};

export { config };
export default config;
