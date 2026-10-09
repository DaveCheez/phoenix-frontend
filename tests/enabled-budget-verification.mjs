// Opt-in local check: real Django budget enforcement through Nuxt.
// Requires PHOENIX_ENABLED_BUDGET_VERIFICATION=1. Refuses any non-local target.
// Does not read or write the normal .env files, db.sqlite3, or production.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launch, sleep, waitFor } from "./guest-cart-browser.mjs";

const ENABLED = process.env.PHOENIX_ENABLED_BUDGET_VERIFICATION === "1";
const LINUX_RUNTIME = process.env.PHOENIX_DJANGO_RUNTIME === "linux-image";
const FRONTEND = join(import.meta.dirname, "..");
const BACKEND = LINUX_RUNTIME
  ? "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-backend-digitalocean-ready\\backend-release-secure-storefront"
  : "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-backend-digitalocean-ready\\backend";
const PYTHON = LINUX_RUNTIME
  ? process.execPath
  : "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-backend-digitalocean-ready\\venv\\Scripts\\python.exe";
const DJANGO52_VENV = "C:\\Users\\davec\\Dev\\Phoenix Vanz\\phoenix-vanz-django52-venv";

function pythonArgs(args) {
  return LINUX_RUNTIME ? [join(FRONTEND, "tests", "django52-python.mjs"), ...args] : args;
}
const HOST = "127.0.0.1";
const IMAGE = "postgres:16";
const ADMIN_USER = "phoenix_vanz_budget_admin";
const APP_USER = "phoenix_vanz_budget_app";
const APP_DATABASE = "phoenix_vanz_budget";
const TEST_DATABASE = "phoenix_vanz_budget_unused";
const SLUG = "budget-verify";
const UNCERTAIN = "We could not confirm the latest basket update. Check your basket before trying the change again.";
const PREFLIGHT = "The basket change was not sent. Try again.";
const POLICIES = {
  label: "TEST ONLY",
  CART_RATE_LIMIT_POLICIES: {
    issuance: [{ window_seconds: 3600, limit: 30 }],
    failed_access: [{ window_seconds: 3600, limit: 30 }],
    authenticated_cart: [{ window_seconds: 3600, limit: 8 }],
  },
  CART_FRONTEND_RATE_LIMIT_POLICIES: {
    csrf: [{ window_seconds: 60, limit: 8 }],
    reset: [{ window_seconds: 3600, limit: 1 }],
  },
};

const secrets = {
  admin: randomBytes(24).toString("hex"),
  app: randomBytes(24).toString("hex"),
  credential: randomBytes(32).toString("hex"),
  csrf: randomBytes(32).toString("hex"),
  hmac: randomBytes(32).toString("hex"),
  contact: randomBytes(32).toString("hex"),
};

const state = {
  container: `phoenix-vanz-budget-${process.pid}`,
  workspace: "",
  media: "",
  mail: "",
  envFile: "",
  django: null,
  nuxt: null,
  browser: null,
  owned: [],
  results: [],
  djangoLines: [],
};

function redact(text) {
  let value = String(text ?? "");
  for (const secret of Object.values(secrets)) {
    if (secret) value = value.replaceAll(secret, "[redacted]");
  }
  return value;
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(redact(message));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function postgresPort() {
  return new Promise((resolve, reject) => {
    const attempt = (port) => {
      if (port > 55531) {
        reject(new Error("No free localhost port was found in 55432-55531."));
        return;
      }
      const server = createServer();
      server.once("error", () => attempt(port + 1));
      server.listen(port, HOST, () => {
        server.close(() => resolve(port));
      });
    };
    attempt(55432);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.input == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    if (options.input != null) child.stdin.end(options.input);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

function assertLocal(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== HOST) {
    throw new Error("Refusing a non-local target.");
  }
  if (parsed.port === "3000" || parsed.port === "8000") {
    throw new Error("Refusing the normal local server ports.");
  }
}

function ownProcess(name, child, port) {
  const record = { name, child, pid: child.pid, port, stopping: false, exitCode: null };
  child.once("exit", (code) => {
    record.exitCode = code;
  });
  state.owned.push(record);
  return record;
}

function portIsListening(text, port) {
  const pattern = new RegExp(`(?:127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0):${port}(?:\\s|$)`);
  return text.split(/\r?\n/).some((line) => pattern.test(line) && line.toUpperCase().includes("LISTENING"));
}

function attach(child, sink) {
  const collect = (chunk) => {
    for (const line of redact(chunk.toString()).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) sink.push({ at: Date.now(), line: trimmed });
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
}

function djangoCart(from = 0) {
  return state.djangoLines
    .filter((row) => row.at >= from && row.line.includes("/api/cart"))
    .map((row) => {
      const match = row.line.match(/"(GET|POST|PATCH|DELETE) (\S+) HTTP\/[0-9.]+" (\d+)/);
      return match
        ? { method: match[1], path: match[2], status: Number(match[3]) }
        : null;
    })
    .filter(Boolean);
}

function validRetryAfter(value) {
  if (!/^[1-9]\d*$/.test(value || "")) return false;
  const number = Number(value);
  return Number.isInteger(number) && String(number) === value && number >= 1 && number <= 86400;
}

async function cookieProof(page, origin) {
  const listed = await page.send("Network.getCookies", { urls: [`${origin}/`] });
  const cookies = (listed.cookies || [])
    .filter((cookie) => cookie.name.startsWith("phoenix_"))
    .map((cookie) => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly === true,
      value: cookie.value,
      expires: cookie.expires,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    names: cookies.map((cookie) => cookie.name),
    httpOnly: cookies.filter((cookie) => cookie.name.includes("guest") || cookie.name.includes("bootstrap")).every((cookie) => cookie.httpOnly),
    proof: createHash("sha256").update(JSON.stringify(cookies)).digest("hex"),
  };
}

async function guestBearer(page, origin) {
  const listed = await page.send("Network.getCookies", { urls: [`${origin}/`] });
  const guest = (listed.cookies || []).find((cookie) => cookie.name === "phoenix_guest_dev");
  if (!guest?.value) throw new Error("The browser had no guest cookie to use for labeled setup.");
  return guest.value;
}

function facts(text) {
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("BUDGET_FACT ")) continue;
    const body = line.slice("BUDGET_FACT ".length);
    const separator = body.indexOf("=");
    if (separator === -1) continue;
    found[body.slice(0, separator)] = body.slice(separator + 1);
  }
  return found;
}

async function djangoShell(env, script) {
  const file = join(tmpdir(), `phoenix-budget-shell-${process.pid}-${randomBytes(4).toString("hex")}.py`);
  await writeFile(file, script);
  try {
    const result = await run(PYTHON, pythonArgs(["manage.py", "shell", "-c", `exec(compile(open(${JSON.stringify(file)}, encoding="utf-8").read(), "budget_shell", "exec"))`]), {
      cwd: BACKEND,
      env,
    });
    if (result.code !== 0 || !result.stdout.includes("BUDGET_FACT ")) {
      fail(new Error(result.stderr || result.stdout || "Django shell returned no facts."));
    }
    return facts(result.stdout);
  } finally {
    await rm(file, { force: true });
  }
}

function baseEnv(pgPort) {
  return {
    ...process.env,
    PHOENIX_VANZ_POSTGRES_TESTS: "1",
    DJANGO_SETTINGS_MODULE: "base.settings_postgres_tests",
    PHOENIX_VANZ_POSTGRES_HOST: HOST,
    PHOENIX_VANZ_POSTGRES_PORT: String(pgPort),
    PHOENIX_VANZ_POSTGRES_NAME: APP_DATABASE,
    PHOENIX_VANZ_POSTGRES_TEST_NAME: TEST_DATABASE,
    PHOENIX_VANZ_POSTGRES_USER: APP_USER,
    PHOENIX_VANZ_POSTGRES_PASSWORD: secrets.app,
    DATABASE_URL: "",
    DJANGO_ALLOWED_HOSTS: "127.0.0.1,localhost",
    CART_APP_CREDENTIAL: secrets.credential,
    CART_RATE_LIMIT_HMAC_KEY: secrets.hmac,
    CART_RATE_LIMIT_ENABLED: "true",
    CART_RATE_LIMIT_POLICIES: JSON.stringify(POLICIES.CART_RATE_LIMIT_POLICIES),
    CART_FRONTEND_RATE_LIMIT_POLICIES: JSON.stringify(POLICIES.CART_FRONTEND_RATE_LIMIT_POLICIES),
    CONTACT_PROXY_SECRET: secrets.contact,
    CONTACT_RECIPIENT_EMAIL: "capture@example.invalid",
    DEFAULT_FROM_EMAIL: "capture@example.invalid",
    PHOENIX_VANZ_EMAIL_FILE_PATH: "/host-mail",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  };
}

const INSPECT_SCRIPT = `
from datetime import timedelta
from django.conf import settings
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone
from cart.models import Cart, CartItem, CartRateLimitCounter, GuestSession
engine = settings.DATABASES["default"]["ENGINE"]
host = settings.DATABASES["default"]["HOST"]
name = settings.DATABASES["default"]["NAME"]
if "sqlite" in engine or host not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit("refusing non-local database")
if name != "${APP_DATABASE}":
    raise SystemExit("database name did not match the disposable database")
print(f"BUDGET_FACT engine={engine}")
print(f"BUDGET_FACT db_name={name}")
print(f"BUDGET_FACT db_host={host}")
print(f"BUDGET_FACT enforcement={settings.CART_RATE_LIMIT_ENABLED}")
print(f"BUDGET_FACT media={settings.MEDIA_ROOT}")
names = list(MigrationRecorder.Migration.objects.filter(app="cart").order_by("name").values_list("name", flat=True))
print("BUDGET_FACT migrations=" + ",".join(names))
with connection.cursor() as cursor:
    cursor.execute("SHOW server_version")
    print("BUDGET_FACT postgres=" + cursor.fetchone()[0])
print(f"BUDGET_FACT carts={Cart.objects.count()}")
print(f"BUDGET_FACT sessions={GuestSession.objects.count()}")
lines = []
for cart in Cart.objects.order_by("created_at", "id"):
    session = cart.guest_session
    for item in cart.items.order_by("id"):
        options = list(item.selected_options.order_by("option_id").values_list("option__name", "option__price_adjustment"))
        rendered = ",".join(f"{option_name}:{price}" for option_name, price in options)
        lines.append(f"qty={item.quantity}|options={rendered}")
    lines.append(f"revoked={bool(session and session.revoked_at)}")
print("BUDGET_FACT basket=" + ";".join(lines))
counter_rows = []
for row in CartRateLimitCounter.objects.order_by("scope", "window_seconds"):
    end = row.window_start + timedelta(seconds=row.window_seconds)
    counter_rows.append("scope=" + row.scope + "|count=" + str(row.count) + "|window_seconds=" + str(row.window_seconds) + "|window_end=" + end.isoformat() + "|expires_at=" + row.expires_at.isoformat())
print("BUDGET_FACT counters=" + " || ".join(counter_rows))
print("BUDGET_FACT now=" + timezone.now().isoformat())
`;

const SEED_SCRIPT = `
from decimal import Decimal
from store.models import Category, Product, ProductOption, ProductOptionGroup
category, _created = Category.objects.get_or_create(slug="budget-cat", defaults={"name": "Budget"})
product, _created = Product.objects.get_or_create(
    slug="${SLUG}",
    defaults={"category": category, "name": "Budget verification", "description": "Disposable budget fixture", "price": Decimal("100.00")},
)
specification, _created = ProductOptionGroup.objects.get_or_create(
    product=product, name="Specification", defaults={"required": True, "display_order": 1, "active": True},
)
extra, _created = ProductOptionGroup.objects.get_or_create(
    product=product, name="Extra", defaults={"required": False, "display_order": 2, "active": True},
)
ProductOption.objects.get_or_create(group=specification, name="Standard", defaults={"price_adjustment": Decimal("0.00"), "is_default": True, "display_order": 1, "active": True})
enhanced, _created = ProductOption.objects.get_or_create(group=specification, name="Enhanced", defaults={"price_adjustment": Decimal("25.00"), "is_default": False, "display_order": 2, "active": True})
none, _created = ProductOption.objects.get_or_create(group=extra, name="None", defaults={"price_adjustment": Decimal("0.00"), "is_default": True, "display_order": 1, "active": True})
print(f"BUDGET_FACT product_id={product.id}")
print(f"BUDGET_FACT base={product.price}")
print(f"BUDGET_FACT enhanced={enhanced.id}:{enhanced.price_adjustment}")
print(f"BUDGET_FACT none={none.id}:{none.price_adjustment}")
`;

const REVOKE_SCRIPT = `
import os
from django.utils import timezone
from cart.models import GuestSession
digest = os.environ.get("PHOENIX_SETUP_TOKEN_HASH", "")
if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
    raise SystemExit("setup digest was not usable")
updated = GuestSession.objects.filter(token_hash=digest, revoked_at__isnull=True).update(revoked_at=timezone.now())
print(f"BUDGET_FACT revoked={updated}")
`;

async function waitUntil(predicate, timeoutMs, label) {
  return waitFor(predicate, timeoutMs, label);
}

function cartRows(page, from = 0) {
  return page.traffic.filter((entry) => entry.at >= from && entry.path.startsWith("/api/cart") && entry.status);
}

function safeRows(rows) {
  return rows.map((entry) => ({
    method: entry.method,
    path: entry.path,
    status: entry.status,
    retryAfter: entry.retryAfter || "",
    setCookieNames: entry.setCookieNames || [],
    action: entry.action || "",
  }));
}

async function jsonFacts(page, method, path, status, from) {
  const entry = [...page.traffic].reverse().find((item) =>
    item.at >= from && item.method === method && item.path === path && item.status === status && item.requestId);
  if (!entry) return null;
  let payload;
  try {
    payload = await page.send("Network.getResponseBody", { requestId: entry.requestId });
  } catch {
    return { status, unavailable: true };
  }
  const raw = payload.base64Encoded ? Buffer.from(payload.body, "base64").toString("utf8") : payload.body;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status, parsed: false };
  }
  return {
    status,
    code: typeof parsed.code === "string" ? parsed.code : "",
    success: parsed.success === true,
    hasCsrfToken: Object.prototype.hasOwnProperty.call(parsed, "csrf_token"),
    limitedError: parsed.error === "Cart access is temporarily limited.",
  };
}

async function main() {
  if (!ENABLED) throw new Error("Refusing to start without PHOENIX_ENABLED_BUDGET_VERIFICATION=1.");
  const pgPort = await postgresPort();
  const djangoPort = await freePort();
  const nuxtPort = await freePort();
  const edgePort = await freePort();
  for (const port of [pgPort, djangoPort, nuxtPort]) {
    if (port === 3000 || port === 8000) throw new Error("Refusing the normal local server ports.");
  }
  const djangoOrigin = `http://${HOST}:${djangoPort}`;
  const origin = `http://${HOST}:${nuxtPort}`;
  assertLocal(djangoOrigin);
  assertLocal(origin);
  const env = baseEnv(pgPort);
  const results = [];

  const existing = await run("docker", ["ps", "-aq", "--filter", `name=^${state.container}$`]);
  if (existing.stdout.trim()) throw new Error("The disposable container name already exists.");
  state.envFile = join(tmpdir(), `phoenix-budget-env-${process.pid}.env`);
  await writeFile(state.envFile, [
    `POSTGRES_USER=${ADMIN_USER}`,
    `POSTGRES_PASSWORD=${secrets.admin}`,
    "POSTGRES_DB=postgres",
    "POSTGRES_HOST_AUTH_METHOD=scram-sha-256",
  ].join("\n"), { mode: 0o600 });
  const started = await run("docker", [
    "run", "-d", "--name", state.container,
    "--publish", `${HOST}:${pgPort}:5432`,
    "--publish", `${HOST}:${djangoPort}:${djangoPort}`,
    "--env-file", state.envFile,
    IMAGE,
  ]);
  if (started.code !== 0) fail(new Error(started.stderr || started.stdout));
  await rm(state.envFile, { force: true });
  state.envFile = "";

  const readyDeadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const probe = await run("docker", ["exec", state.container, "pg_isready", "-U", ADMIN_USER, "-d", "postgres"]);
    if (probe.code === 0) {
      ready = true;
      break;
    }
    await sleep(1000);
  }
  if (!ready) throw new Error("PostgreSQL did not become ready.");
  console.log("postgres-ready");
  const listeners = await run("netstat", ["-ano"]);
  const published = listeners.stdout.split(/\r?\n/).filter((line) => line.includes(`:${pgPort}`) && line.toUpperCase().includes("LISTENING"));
  if (!published.length || published.some((line) => !line.includes(`${HOST}:${pgPort}`) && !line.includes(`[::1]:${pgPort}`))) {
    throw new Error("PostgreSQL was not published on loopback only.");
  }
  const hba = "local all all scram-sha-256\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all ::1/128 scram-sha-256\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n";
  const written = await run("docker", ["exec", "-i", state.container, "sh", "-c", 'cat > "$PGDATA/pg_hba.conf"'], { input: hba });
  if (written.code !== 0) fail(new Error(written.stderr));
  const setupSql = `CREATE ROLE ${APP_USER} LOGIN PASSWORD '${secrets.app}';\nCREATE DATABASE ${APP_DATABASE} OWNER ${APP_USER};\nSELECT pg_reload_conf();\n`;
  const setup = await run("docker", [
    "exec", "-i", state.container, "sh", "-c",
    'export PGPASSWORD="$POSTGRES_PASSWORD"; psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1',
  ], { input: setupSql });
  if (setup.code !== 0) fail(new Error(setup.stderr || setup.stdout));
  const rules = await run("docker", [
    "exec", state.container, "sh", "-c",
    'export PGPASSWORD="$POSTGRES_PASSWORD"; psql -U "$POSTGRES_USER" -d postgres -At -c "SHOW server_version" -c "SELECT type || \' \' || COALESCE(address, \'local\') || \' \' || auth_method FROM pg_hba_file_rules ORDER BY line_number"',
  ]);
  if (rules.code !== 0) fail(new Error(rules.stderr));
  if (rules.stdout.includes("trust")) throw new Error("PostgreSQL authentication still allows trust.");

  if (LINUX_RUNTIME) {
    state.mail = await mkdtemp(join(tmpdir(), "phoenix-pair-mail-"));
    env.PHOENIX_RELEASE_BACKEND = BACKEND;
    env.PHOENIX_DJANGO52_VENV = DJANGO52_VENV;
    env.PHOENIX_DJANGO_NETWORK_CONTAINER = state.container;
    env.PHOENIX_DJANGO_INTERNAL_POSTGRES_PORT = "5432";
    env.PHOENIX_HOST_MAIL_DIR = state.mail;
  }
  const migrated = await run(PYTHON, pythonArgs(["manage.py", "migrate", "--noinput"]), { cwd: BACKEND, env });
  if (migrated.code !== 0) fail(new Error(migrated.stderr || migrated.stdout));
  const seeded = await djangoShell(env, SEED_SCRIPT);
  const inspected = await djangoShell(env, INSPECT_SCRIPT);
  if (!String(inspected.migrations || "").split(",").includes("0006_frontend_budget_scopes")) {
    throw new Error("cart migration 0006_frontend_budget_scopes was not applied.");
  }
  if (inspected.enforcement !== "True") throw new Error("Budget enforcement was not enabled in the disposable process.");
  console.log(`database-ready postgres=${inspected.postgres} migration=0006`);
  state.media = inspected.media || "";

  state.django = spawn(PYTHON, pythonArgs(["manage.py", "runserver", `${HOST}:${djangoPort}`, "--noreload"]), {
    cwd: BACKEND,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  ownProcess("django", state.django, djangoPort);
  attach(state.django, state.djangoLines);
  try {
    await waitUntil(async () => {
      try {
        const health = await fetch(`${djangoOrigin}/health/`);
        return health.status === 200 ? true : null;
      } catch {
        return null;
      }
    }, 60000, "Django startup");
  } catch (error) {
    const tail = state.djangoLines.slice(-8).map((row) => row.line).join(" | ");
    fail(new Error(`${error instanceof Error ? error.message : error} ${tail}`));
  }

  state.workspace = await mkdtemp(join(tmpdir(), "phoenix-budget-nuxt-"));
  const copied = await run("robocopy", [
    FRONTEND, state.workspace, "/E",
    "/XD", "node_modules", ".nuxt", ".output", ".git",
    "/XF", ".env", ".env.local", ".env.production",
    "/NFL", "/NDL", "/NJH", "/NJS",
  ]);
  if (copied.code >= 8) fail(new Error(copied.stderr || copied.stdout));
  await symlink(join(FRONTEND, "node_modules"), join(state.workspace, "node_modules"), "junction");
  const nuxtEnv = {
    ...process.env,
    HOST,
    PORT: String(nuxtPort),
    NUXT_HOST: HOST,
    NUXT_PORT: String(nuxtPort),
    NUXT_CART_ORIGIN: origin,
    NUXT_CART_CSRF_SECRET: secrets.csrf,
    NUXT_CART_APP_CREDENTIAL: secrets.credential,
    NUXT_DJANGO_API_BASE: `${djangoOrigin}/api`,
    NUXT_CONTACT_PROXY_SECRET: secrets.contact,
    NUXT_CART_TRUSTED_INGRESS: "",
    NUXT_TELEMETRY_DISABLED: "1",
  };
  delete nuxtEnv.NUXT_IGNORE_LOCK;
  const nuxi = join(state.workspace, "node_modules", "@nuxt", "cli", "bin", "nuxi.mjs");
  state.nuxt = spawn(process.execPath, [nuxi, "dev", "--host", HOST, "--port", String(nuxtPort)], {
    cwd: state.workspace,
    env: nuxtEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  ownProcess("nuxt", state.nuxt, nuxtPort);
  const nuxtLogs = [];
  attach(state.nuxt, nuxtLogs);
  await waitUntil(async () => {
    try {
      const health = await fetch(`${origin}/api/health`);
      return health.status === 200 ? true : null;
    } catch {
      return null;
    }
  }, 120000, "Nuxt startup");
  console.log("nuxt-ready");

  state.browser = await launch({ port: edgePort });
  if (state.browser.child) ownProcess("edge", state.browser.child, edgePort);
  const browserVersion = await state.browser.version();
  const commits = {
    frontend: (await run("git", ["rev-parse", "HEAD"], { cwd: FRONTEND })).stdout.trim(),
    backend: (await run("git", ["rev-parse", "HEAD"], { cwd: BACKEND })).stdout.trim(),
  };

  async function snapshot() {
    return djangoShell(env, INSPECT_SCRIPT);
  }

  function counterRows(current) {
    return String(current.counters || "").split(" || ").filter(Boolean).map((line) => Object.fromEntries(line.split("|").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), part.slice(index + 1)];
    })));
  }

  async function nuxtCsrf() {
    const response = await fetch(`${origin}/api/cart/csrf`, {
      headers: {
        accept: "application/json",
        origin,
        "x-phoenix-csrf-request": "1",
        "sec-fetch-site": "same-origin",
      },
    });
    const retryAfter = response.headers.get("retry-after") || "";
    let code = "";
    let hasCsrfToken = false;
    try {
      const parsed = await response.json();
      code = typeof parsed.code === "string" ? parsed.code : "";
      hasCsrfToken = Object.prototype.hasOwnProperty.call(parsed, "csrf_token");
    } catch {
      code = "";
    }
    return {
      label: "direct-nuxt-csrf",
      status: response.status,
      code,
      hasCsrfToken,
      retryAfter,
      setCookie: response.headers.has("set-cookie"),
    };
  }

  async function alignCsrfWindow() {
    const clock = await snapshot();
    const now = Date.parse(clock.now);
    const windowSeconds = POLICIES.CART_FRONTEND_RATE_LIMIT_POLICIES.csrf[0].window_seconds;
    const remainingMs = windowSeconds * 1000 - (now % (windowSeconds * 1000));
    if (remainingMs < 25000) await sleep(remainingMs + 500);
  }

  async function scenarioCsrf() {
    const id = "enabled-csrf-denial";
    await alignCsrfWindow();
    const context = await state.browser.context();
    const page = await state.browser.page(context);
    try {
      await page.open(`${origin}/product/${SLUG}`);
      await waitUntil(async () => (await page.text()).includes("Start a new basket") || null, 20000, "start control");
      await page.eval(`(() => { window.__phoenixClickErrors = []; window.addEventListener("unhandledrejection", (event) => { window.__phoenixClickErrors.push(String(event.reason?.message || "rejection")); }); window.addEventListener("error", (event) => { window.__phoenixClickErrors.push(String(event.message || "error")); }); return true; })()`);
      const first = await page.eval(`fetch("/api/cart/csrf", { headers: { accept: "application/json", "x-phoenix-csrf-request": "1" } }).then((response) => response.status)`, true);
      const permitted = [{ label: "browser-csrf-allowance", status: first }];
      const limit = POLICIES.CART_FRONTEND_RATE_LIMIT_POLICIES.csrf[0].limit;
      while (permitted.length < limit) {
        const attempt = await nuxtCsrf();
        permitted.push(attempt);
        if (attempt.status !== 200) break;
      }
      const before = await snapshot();
      const csrfRow = counterRows(before).find((row) => row.scope === "csrf");
      const cookieBefore = await cookieProof(page, origin);
      if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced could not be selected");
      const mark = Date.now();
      const clicked = await page.clickButton("Start a new basket");
      await waitUntil(async () => cartRows(page, mark).some((entry) => entry.path === "/api/cart/csrf" && entry.status === 429) || null, 15000, "csrf denial");
      await sleep(1500);
      const rows = cartRows(page, mark);
      const denial = rows.find((entry) => entry.path === "/api/cart/csrf" && entry.status === 429);
      const denialFacts = await jsonFacts(page, "GET", "/api/cart/csrf", 429, mark);
      const after = await snapshot();
      const cookieAfter = await cookieProof(page, origin);
      const text = await page.text();
      const selected = await page.eval(`(() => [...document.querySelectorAll("label")].filter((label) => label.querySelector("input")?.checked).map((label) => (label.innerText || "").trim()))()`);
      const startDisabled = await page.eval(`(() => { const button = [...document.querySelectorAll("button")].find((element) => (element.innerText || "").includes("Start a new basket")); return !button || button.disabled; })()`);
      const clickErrors = await page.eval(`window.__phoenixClickErrors || []`);
      const mutations = rows.filter((entry) => ["/api/cart/create", "/api/cart/add", "/api/cart/update", "/api/cart/reset"].includes(entry.path));
      const passed = clicked
        && permitted.length === limit
        && permitted.every((entry) => entry.status === 200)
        && denial
        && validRetryAfter(denial.retryAfter)
        && (denial.setCookieNames || []).length === 0
        && denialFacts?.code === "CART_RATE_LIMITED"
        && denialFacts?.hasCsrfToken === false
        && mutations.length === 0
        && cookieBefore.proof === cookieAfter.proof
        && before.carts === after.carts
        && before.sessions === after.sessions
        && text.includes(PREFLIGHT)
        && !text.includes("added to your cart")
        && Array.isArray(selected) && selected.some((label) => label.includes("Enhanced"))
        && startDisabled === false
        && Array.isArray(clickErrors) && clickErrors.length === 0;
      const quietFrom = Date.now();
      const windowEnd = Date.parse(csrfRow?.window_end || "");
      const expiresAt = Date.parse(csrfRow?.expires_at || "");
      if (!Number.isFinite(windowEnd) || !Number.isFinite(expiresAt) || expiresAt - windowEnd < 240000) {
        throw new Error("The recorded window end was missing or matched cleanup expiry.");
      }
      const waitMs = windowEnd - Date.now() + 750;
      if (waitMs > 70000) throw new Error("The recorded window end was too far away to wait.");
      if (waitMs > 0) await sleep(waitMs);
      const duringWait = cartRows(page, quietFrom).filter((entry) => ["/api/cart/csrf", "/api/cart/create", "/api/cart/add", "/api/cart/reset"].includes(entry.path));
      const recoveryMark = Date.now();
      const recoveredClick = await page.clickButton("Start a new basket");
      await waitUntil(async () => cartRows(page, recoveryMark).some((entry) => entry.path === "/api/cart/create" && entry.status === 201) || null, 20000, "window recovery");
      const recoveryRows = cartRows(page, recoveryMark);
      const recoveryCsrf = recoveryRows.find((entry) => entry.path === "/api/cart/csrf" && entry.status === 200);
      const recoveryCreate = recoveryRows.find((entry) => entry.path === "/api/cart/create" && entry.status === 201);
      const recovered = await snapshot();
      const recoveredCsrf = counterRows(recovered).filter((row) => row.scope === "csrf");
      const recoveredText = await page.text();
      const recoveredSelected = await page.eval(`(() => [...document.querySelectorAll("label")].filter((label) => label.querySelector("input")?.checked).map((label) => (label.innerText || "").trim()))()`);
      const recoveryAdds = recoveryRows.filter((entry) => entry.path === "/api/cart/add");
      const messageCleared = !recoveredText.includes(PREFLIGHT);
      results.push({
        id,
        status: passed && duringWait.length === 0 && recoveredClick && recoveryCsrf && recoveryCreate && messageCleared && recoveryAdds.length === 0 && Array.isArray(recoveredSelected) && recoveredSelected.some((label) => label.includes("Enhanced")) ? "PASS" : "FAIL",
        permitted: permitted.map((entry) => ({ label: entry.label, status: entry.status, code: entry.code || "CART_BUDGET_ALLOWED" })),
        denial: denial ? { method: denial.method, path: denial.path, status: denial.status, retryAfter: denial.retryAfter, setCookieNames: denial.setCookieNames, code: denialFacts?.code || "", hasCsrfToken: denialFacts?.hasCsrfToken === true, limitedError: denialFacts?.limitedError === true } : null,
        mutations: safeRows(mutations),
        cookieUnchanged: cookieBefore.proof === cookieAfter.proof,
        cookieNames: cookieAfter.names,
        cartsBefore: before.carts,
        cartsAfter: after.carts,
        sessionsBefore: before.sessions,
        sessionsAfter: after.sessions,
        showedPreflight: text.includes(PREFLIGHT),
        selectionRetained: Array.isArray(selected) && selected.some((label) => label.includes("Enhanced")),
        startEnabled: startDisabled === false,
        clickErrors,
        messageCleared,
        automaticReplayDuringWait: duringWait.length,
        recovery: safeRows(recoveryRows.filter((entry) => entry.path.startsWith("/api/cart"))),
        csrfCountersAfterRecovery: recoveredCsrf,
        windowEnd: csrfRow?.window_end || "",
        expiresAt: csrfRow?.expires_at || "",
      });
    } finally {
      await state.browser.dispose(context);
    }
  }

  async function scenarioReset() {
    const id = "enabled-reset-denial";
    const context = await state.browser.context();
    const page = await state.browser.page(context);
    try {
      await page.open(`${origin}/product/${SLUG}`);
      await waitUntil(async () => (await page.text()).includes("Start a new basket") || null, 20000, "start control");
      const started = Date.now();
      if (!(await page.clickButton("Start a new basket"))) throw new Error("Start could not be clicked.");
      await waitUntil(async () => cartRows(page, started).some((entry) => entry.path === "/api/cart/create" && entry.status === 201) || null, 20000, "basket start");
      const bearer = await guestBearer(page, origin);
      const guard = await fetch(`${origin}/api/cart/reset`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", origin },
        body: JSON.stringify({ confirm: true }),
      });
      const guardBody = await guard.json().catch(() => ({}));
      const beforeGuard = await snapshot();
      const digest = createHash("sha256").update(bearer).digest("hex");
      const revoked = await djangoShell({ ...env, PHOENIX_SETUP_TOKEN_HASH: digest }, REVOKE_SCRIPT);
      await page.open(`${origin}/product/${SLUG}`);
      await waitUntil(async () => (await page.text()).includes("We cannot reopen your previous basket.") || null, 20000, "recovery notice");
      const setupMark = Date.now();
      const setup = await fetch(`${djangoOrigin}/api/cart/budget/`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-phoenix-app-credential": secrets.credential,
          "x-phoenix-shopper-address": HOST,
        },
        body: JSON.stringify({ operation: "reset" }),
      });
      const setupBody = await setup.json().catch(() => ({}));
      const setupDjango = djangoCart(setupMark);
      const before = await snapshot();
      const cookieBefore = await cookieProof(page, origin);
      const mark = Date.now();
      if (!(await page.clickButton("Start a new basket"))) throw new Error("Reset control could not be clicked.");
      await waitUntil(async () => cartRows(page, mark).some((entry) => entry.path === "/api/cart/reset" && entry.status) || null, 15000, "reset response");
      await sleep(1500);
      const rows = cartRows(page, mark);
      const denial = rows.find((entry) => entry.path === "/api/cart/reset");
      const denialFacts = denial ? await jsonFacts(page, "POST", "/api/cart/reset", denial.status, mark) : null;
      const upstream = djangoCart(mark);
      const after = await snapshot();
      const cookieAfter = await cookieProof(page, origin);
      const text = await page.text();
      const guestProbe = upstream.filter((entry) => entry.path === "/api/cart/" || entry.path === "/api/cart");
      const passed = guard.status === 403
        && revoked.revoked === "1"
        && setup.status === 200
        && setupBody.code === "CART_BUDGET_ALLOWED"
        && denial?.status === 429
        && denialFacts?.code === "CART_RATE_LIMITED"
        && validRetryAfter(denial.retryAfter)
        && guestProbe.length === 0
        && !rows.some((entry) => entry.path === "/api/cart/create" || entry.path === "/api/cart")
        && cookieBefore.proof === cookieAfter.proof
        && before.basket === after.basket
        && before.carts === after.carts
        && before.sessions === after.sessions
        && text.includes(UNCERTAIN);
      results.push({
        id,
        status: passed ? "PASS" : "FAIL",
        guard: { label: "direct-nuxt-reset-without-csrf", status: guard.status, code: guardBody.code || "" },
        resetCounterBeforeGuard: counterRows(beforeGuard).filter((row) => row.scope === "reset"),
        setup: { label: "direct-django-reset-budget", status: setup.status, code: setupBody.code || "", django: setupDjango },
        browser: safeRows(rows),
        body: { code: denialFacts?.code || "", hasCsrfToken: denialFacts?.hasCsrfToken === true, limitedError: denialFacts?.limitedError === true },
        upstream,
        cookieUnchanged: cookieBefore.proof === cookieAfter.proof,
        basketUnchanged: before.basket === after.basket,
        basket: after.basket,
        carts: after.carts,
        sessions: after.sessions,
        showedWarning: text.includes(UNCERTAIN),
      });
    } finally {
      await state.browser.dispose(context);
    }
  }

  async function scenarioAuthenticated() {
    const id = "enabled-authenticated-denial";
    const context = await state.browser.context();
    const page = await state.browser.page(context);
    try {
      await page.open(`${origin}/product/${SLUG}`);
      await waitUntil(async () => (await page.text()).includes("Start a new basket") || null, 20000, "start control");
      const started = Date.now();
      if (!(await page.clickButton("Start a new basket"))) throw new Error("Start could not be clicked.");
      await waitUntil(async () => /add to cart/i.test(await page.text()) || null, 20000, "add control");
      if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced could not be selected.");
      if (!(await page.clickLabel("None"))) throw new Error("None could not be selected.");
      const addMark = Date.now();
      if (!(await page.clickButton("Add to Cart"))) throw new Error("The confirming add could not be clicked.");
      await waitUntil(async () => (await page.text()).includes("added to your cart") || null, 20000, "confirmed add");
      await sleep(4500);
      const bearer = await guestBearer(page, origin);
      const limit = POLICIES.CART_RATE_LIMIT_POLICIES.authenticated_cart[0].limit;
      const setup = [];
      let guard = 0;
      while (guard < limit + 2) {
        const current = counterRows(await snapshot()).find((row) => row.scope === "authenticated_cart");
        const count = Number(current?.count || 0);
        if (count >= limit) break;
        const response = await fetch(`${djangoOrigin}/api/cart/`, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${bearer}`,
            "x-phoenix-app-credential": secrets.credential,
            "x-phoenix-shopper-address": HOST,
          },
        });
        setup.push({ label: "direct-django-authenticated-read", status: response.status });
        if (response.status !== 200) break;
        guard += 1;
      }
      const before = await snapshot();
      const cookieBefore = await cookieProof(page, origin);
      const mark = Date.now();
      if (!(await page.clickButton("Add to Cart"))) throw new Error("The denied add could not be clicked.");
      await waitUntil(async () => cartRows(page, mark).some((entry) => entry.path === "/api/cart/add" && entry.status) || null, 15000, "add response");
      await sleep(1500);
      const rows = cartRows(page, mark);
      const csrf = rows.find((entry) => entry.path === "/api/cart/csrf");
      const denial = rows.find((entry) => entry.path === "/api/cart/add");
      const denialFacts = denial ? await jsonFacts(page, "POST", "/api/cart/add", denial.status, mark) : null;
      const upstream = djangoCart(mark);
      const after = await snapshot();
      const cookieAfter = await cookieProof(page, origin);
      const text = await page.text();
      const repeats = rows.filter((entry) => entry.path === "/api/cart/add").length;
      const passed = csrf?.status === 200
        && denial?.status === 429
        && denialFacts?.code === "CART_RATE_LIMITED"
        && validRetryAfter(denial.retryAfter)
        && upstream.some((entry) => entry.path === "/api/cart/add/" && entry.status === 429)
        && repeats === 1
        && !text.includes("added to your cart")
        && text.includes(UNCERTAIN)
        && cookieBefore.proof === cookieAfter.proof
        && before.basket === after.basket
        && before.sessions === after.sessions;
      results.push({
        id,
        status: passed ? "PASS" : "FAIL",
        setup,
        browser: safeRows(rows),
        body: { code: denialFacts?.code || "", hasCsrfToken: denialFacts?.hasCsrfToken === true, limitedError: denialFacts?.limitedError === true },
        upstream,
        retryAfter: denial?.retryAfter || "",
        cookieUnchanged: cookieBefore.proof === cookieAfter.proof,
        basketUnchanged: before.basket === after.basket,
        basket: after.basket,
        sessions: after.sessions,
        automaticRepeats: Math.max(0, repeats - 1),
        showedWarning: text.includes(UNCERTAIN),
        authenticatedCounters: counterRows(after).filter((row) => row.scope === "authenticated_cart"),
      });
    } finally {
      await state.browser.dispose(context);
    }
  }

  async function scenarioShopper() {
    const id = "guest-paid-option-quantity";
    const context = await state.browser.context();
    const page = await state.browser.page(context);
    try {
      await page.open(`${origin}/product/${SLUG}`);
      await waitUntil(async () => (await page.text()).includes("Start a new basket") || null, 20000, "start control");
      const started = Date.now();
      if (!(await page.clickButton("Start a new basket"))) throw new Error("Start could not be clicked.");
      await waitUntil(async () => /add to cart/i.test(await page.text()) || null, 20000, "add control");
      if (!(await page.clickLabel("Enhanced"))) throw new Error("Enhanced could not be selected.");
      if (!(await page.clickLabel("None"))) throw new Error("None could not be selected.");
      if (!(await page.clickButton("Add to Cart"))) throw new Error("Add could not be clicked.");
      await waitUntil(async () => (await page.text()).includes("added to your cart") || null, 20000, "confirmed add");
      await page.open(`${origin}/cart`);
      await waitUntil(async () => {
        const ready = await page.eval(`(() => { const button = document.querySelector('button[aria-label^="Increase "]'); return Boolean(button && !button.disabled); })()`);
        return ready || null;
      }, 20000, "quantity control");
      const reloaded = await page.text();
      const beforeQty = await page.eval(`document.querySelector('input[type=number]')?.value || ""`);
      const mark = Date.now();
      if (!(await page.clickIncrease())) throw new Error("Quantity increase could not be clicked.");
      await waitUntil(async () => cartRows(page, mark).some((entry) => entry.path === "/api/cart/update" && entry.status === 200) || null, 20000, "quantity update");
      await sleep(1000);
      const afterQty = await page.eval(`document.querySelector('input[type=number]')?.value || ""`);
      const rows = cartRows(page, mark);
      const passed = reloaded.includes("Enhanced")
        && reloaded.includes("125")
        && beforeQty === "1"
        && afterQty === "2"
        && rows.some((entry) => entry.path === "/api/cart/update" && entry.status === 200);
      results.push({
        id,
        status: passed ? "PASS" : "FAIL",
        reloadedHasEnhanced: reloaded.includes("Enhanced"),
        reloadedHasPaidTotal: reloaded.includes("125"),
        quantityBefore: beforeQty,
        quantityAfter: afterQty,
        rows: safeRows(rows),
      });
    } finally {
      await state.browser.dispose(context);
    }
  }

  async function scenarioContact() {
    const id = "contact-captured-reply-to";
    const shopper = "pair-check@example.invalid";
    const response = await fetch(`${origin}/api/contact`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        name: "Pair Check",
        email: shopper,
        phone: "01234 567890",
        message: "Local release assembly check.",
        website: "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    const names = state.mail ? await readdir(state.mail) : [];
    const captured = [];
    for (const name of names) {
      captured.push(await readFile(join(state.mail, name), "utf8"));
    }
    const replyLine = captured.map((text) => text.split(/\r?\n/).find((line) => line.toLowerCase().startsWith("reply-to:")) || "").find(Boolean) || "";
    const saved = await djangoShell(env, `
from store.models import Enquiry
row = Enquiry.objects.order_by("-id").first()
print("BUDGET_FACT enquiry=" + (row.email if row else ""))
print("BUDGET_FACT email_status=" + (row.email_status if row else ""))
print("BUDGET_FACT reference=" + (row.reference if row else ""))
`);
    const passed = response.status === 201
      && body.code === "ENQUIRY_RECEIVED"
      && saved.enquiry === shopper
      && saved.email_status === "sent"
      && replyLine.toLowerCase() === `reply-to: ${shopper}`;
    results.push({
      id,
      status: passed ? "PASS" : "FAIL",
      httpStatus: response.status,
      code: body.code || "",
      saved: saved.email_status || "",
      replyToMatches: replyLine.toLowerCase() === `reply-to: ${shopper}`,
      capturedFiles: names.length,
      inboxDelivery: false,
    });
  }

  async function scenarioAssets() {
    const id = "health-admin-static";
    const djangoHealth = await fetch(`${djangoOrigin}/health/`);
    const admin = await fetch(`${djangoOrigin}/admin/login/`);
    const html = await admin.text();
    const href = html.match(/href="([^"]+\.css[^"]*)"/);
    let cssStatus = 0;
    let cssType = "";
    if (href) {
      const css = await fetch(new URL(href[1], djangoOrigin));
      cssStatus = css.status;
      cssType = css.headers.get("content-type") || "";
      await css.arrayBuffer();
    }
    const healthPort = await freePort();
    const built = spawn(process.execPath, [join(FRONTEND, ".output", "server", "index.mjs")], {
      cwd: FRONTEND,
      env: {
        ...process.env,
        HOST,
        PORT: String(healthPort),
        NITRO_HOST: HOST,
        NITRO_PORT: String(healthPort),
        NUXT_DJANGO_API_BASE: `${djangoOrigin}/api`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    ownProcess("built-nuxt", built, healthPort);
    let builtHealth = 0;
    try {
      await waitUntil(async () => {
        try {
          const response = await fetch(`http://${HOST}:${healthPort}/api/health`);
          builtHealth = response.status;
          return response.status === 200 ? true : null;
        } catch {
          return null;
        }
      }, 20000, "built server health");
    } catch {
      builtHealth = 0;
    }
    const passed = djangoHealth.status === 200 && admin.status === 200 && cssStatus === 200 && cssType.includes("text/css") && builtHealth === 200;
    results.push({
      id,
      status: passed ? "PASS" : "FAIL",
      djangoHealth: djangoHealth.status,
      admin: admin.status,
      cssStatus,
      cssType,
      builtHealth,
    });
  }

  for (const [label, fn] of [
    ["scenario-csrf", scenarioCsrf],
    ["scenario-reset", scenarioReset],
    ["scenario-shopper", scenarioShopper],
    ["scenario-authenticated", scenarioAuthenticated],
    ["scenario-contact", scenarioContact],
    ["scenario-assets", scenarioAssets],
  ]) {
    console.log(label);
    try {
      await fn();
    } catch (error) {
      results.push({
        id: label,
        status: "FAIL",
        detail: redact(error instanceof Error ? error.message : error),
      });
    }
  }

  const summary = {
    commits,
    node: process.version,
    browser: browserVersion,
    postgres: inspected.postgres,
    database: { engine: inspected.engine, name: inspected.db_name, host: inspected.db_host, port: pgPort },
    product: { id: seeded.product_id, base: seeded.base, enhanced: seeded.enhanced, none: seeded.none },
    policies: POLICIES,
    migrationApplied: String(inspected.migrations || "").includes("0006_frontend_budget_scopes"),
    results,
  };
  state.results = results;
  console.log(JSON.stringify(summary, null, 2));
}

async function removeWorkspace(dir) {
  const link = join(dir, "node_modules");
  const info = await lstat(link).catch(() => null);
  if (info?.isSymbolicLink()) await unlink(link).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

async function stopOwned(record) {
  if (!record?.pid || record.port === 3000 || record.port === 8000) {
    return { name: record?.name || "unknown", stopped: false, portFree: false };
  }
  record.stopping = true;
  if (record.exitCode == null) {
    await run("taskkill", ["/PID", String(record.pid), "/T", "/F"]);
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && record.exitCode == null) await sleep(200);
  const listeners = await run("netstat", ["-ano"]);
  return {
    name: record.name,
    port: record.port,
    pid: record.pid,
    exitCode: record.exitCode,
    portFree: !portIsListening(listeners.stdout, record.port),
    intentionalStop: true,
  };
}

async function cleanup() {
  const shutdown = [];
  if (state.browser) await state.browser.close().catch(() => {});
  for (const record of state.owned) shutdown.push(await stopOwned(record));
  if (state.container) {
    await run("docker", ["rm", "-f", "-v", state.container]);
    const left = await run("docker", ["ps", "-aq", "--filter", `name=^${state.container}$`]);
    shutdown.push({ name: "postgres", containerRemoved: left.stdout.trim() === "" });
    if (LINUX_RUNTIME) {
      const listeners = await run("netstat", ["-ano"]);
      for (const item of shutdown) {
        if (item.name === "django" && item.port) {
          item.portFree = !portIsListening(listeners.stdout, item.port);
        }
      }
    }
  }
  if (state.workspace) {
    try {
      await removeWorkspace(state.workspace);
      shutdown.push({ name: "workspace", removed: true });
    } catch {
      shutdown.push({ name: "workspace", removed: false });
    }
  }
  if (state.media && state.media.includes("phoenix-vanz-pgtest-media-")) {
    await rm(state.media, { recursive: true, force: true }).catch(() => {});
  }
  if (state.mail) await rm(state.mail, { recursive: true, force: true }).catch(() => {});
  if (state.envFile) await rm(state.envFile, { force: true }).catch(() => {});
  return shutdown;
}

if (!ENABLED) {
  console.error("Refusing to start without PHOENIX_ENABLED_BUDGET_VERIFICATION=1.");
  process.exit(2);
}

let failed = false;
try {
  await main();
  failed = state.results.some((result) => result.status === "FAIL");
} catch (error) {
  failed = true;
  console.error(redact(error instanceof Error ? error.stack || error.message : error));
} finally {
  const shutdown = await cleanup();
  const shutdownFailed = shutdown.some((item) => item.portFree === false || item.containerRemoved === false);
  console.log(JSON.stringify({ shutdown }, null, 2));
  process.exit(failed || shutdownFailed ? 1 : 0);
}
