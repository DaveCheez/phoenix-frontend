// Runs the saved Linux CPython 3.11 virtualenv inside the local Django 5.2 image.
// The parent passes manage.py arguments. PostgreSQL stays on the disposable
// container network at 127.0.0.1:5432. This file does not print environment values.

import { spawn } from "node:child_process";

const image = "phoenix-vanz-django52-py311:local";
const backend = process.env.PHOENIX_RELEASE_BACKEND;
const venv = process.env.PHOENIX_DJANGO52_VENV;
const network = process.env.PHOENIX_DJANGO_NETWORK_CONTAINER;
const internalPort = process.env.PHOENIX_DJANGO_INTERNAL_POSTGRES_PORT || "";
const mailDir = process.env.PHOENIX_HOST_MAIL_DIR || "";
const tempDir = process.env.TEMP || process.env.TMP || "";

if (!backend || !venv || !network) {
  process.stderr.write("The Linux Django runtime is missing its local paths.\n");
  process.exit(2);
}

const args = process.argv.slice(2).map((arg) => {
  if (!tempDir) return arg;
  const escaped = tempDir.replace(/\\/g, "\\\\");
  return arg.replaceAll(`${escaped}\\\\`, "/host-tmp/").replaceAll(tempDir, "/host-tmp");
});

let bindIndex = args.findIndex((arg) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(arg) || /^\[::1\]:\d+$/.test(arg));
if (args.includes("runserver") && bindIndex !== -1) {
  const port = args[bindIndex].split(":").pop();
  args[bindIndex] = `0.0.0.0:${port}`;
}

const dockerArgs = [
  "run", "--rm", "-i",
  "--network", `container:${network}`,
  "-v", `${backend}:/work`,
  "-v", `${venv}:/opt/venv`,
  "-w", "/work",
];
if (tempDir) dockerArgs.push("-v", `${tempDir}:/host-tmp`);
if (mailDir) dockerArgs.push("-v", `${mailDir}:/host-mail`);

const forwarded = [
  "PHOENIX_VANZ_POSTGRES_TESTS",
  "DJANGO_SETTINGS_MODULE",
  "PHOENIX_VANZ_POSTGRES_HOST",
  "PHOENIX_VANZ_POSTGRES_PORT",
  "PHOENIX_VANZ_POSTGRES_NAME",
  "PHOENIX_VANZ_POSTGRES_TEST_NAME",
  "PHOENIX_VANZ_POSTGRES_USER",
  "PHOENIX_VANZ_POSTGRES_PASSWORD",
  "DATABASE_URL",
  "DJANGO_ALLOWED_HOSTS",
  "CART_APP_CREDENTIAL",
  "CART_RATE_LIMIT_HMAC_KEY",
  "CART_RATE_LIMIT_ENABLED",
  "CART_RATE_LIMIT_POLICIES",
  "CART_FRONTEND_RATE_LIMIT_POLICIES",
  "PHOENIX_SETUP_TOKEN_HASH",
  "PHOENIX_VANZ_EMAIL_FILE_PATH",
  "CONTACT_PROXY_SECRET",
  "CONTACT_RECIPIENT_EMAIL",
  "DEFAULT_FROM_EMAIL",
  "PYTHONIOENCODING",
  "PYTHONUNBUFFERED",
];
for (const key of forwarded) {
  if (process.env[key] == null) continue;
  let value = process.env[key];
  if (key === "PHOENIX_VANZ_POSTGRES_PORT" && internalPort) value = internalPort;
  dockerArgs.push("-e", `${key}=${value}`);
}

dockerArgs.push("--entrypoint", "/opt/venv/bin/python", image, ...args);
const child = spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", () => process.exit(1));
