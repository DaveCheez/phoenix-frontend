const rawBase = process.argv[2] || process.env.FRONTEND_URL;

if (!rawBase) {
  console.error("Usage: npm run smoke -- https://your-frontend.example");
  process.exit(2);
}

const base = rawBase.replace(/\/+$/, "");
const checks = [
  { path: "/api/health", type: "json" },
  { path: "/", type: "html" },
  { path: "/cart", type: "html" },
  { path: "/favicon.ico", type: "asset" },
  { path: "/api/categories?type=product", type: "json" },
  { path: "/api/slides", type: "json" },
  { path: "/api/cart/create", type: "json", method: "POST", body: "{}" },
];

let failed = false;

for (const check of checks) {
  const url = `${base}${check.path}`;
  try {
    const response = await fetch(url, {
      method: check.method || "GET",
      body: check.body,
      headers: {
        accept: check.type === "json" ? "application/json" : "*/*",
        ...(check.body ? { "content-type": "application/json" } : {}),
      },
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();

    let detail = `${response.status} ${contentType || "unknown"}`;
    if (check.type === "json" && body) {
      try {
        const parsed = JSON.parse(body);
        const size = Array.isArray(parsed)
          ? `${parsed.length} item(s)`
          : parsed?.status || parsed?.code || "object";
        detail += ` ${size}`;
      } catch {
        detail += " invalid-json";
      }
    }

    if (!response.ok) {
      failed = true;
      console.error(`FAIL ${check.path}: ${detail}`);
      console.error(body.slice(0, 500));
    } else {
      console.log(`PASS ${check.path}: ${detail}`);
    }
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.path}:`, error);
  }
}

if (failed) process.exit(1);
