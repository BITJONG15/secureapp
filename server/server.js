const http = require("http");
const path = require("path");

const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const { Server } = require("socket.io");

const { initializeSocket } = require("./socket");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGINS = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
const SESSION_LINK_BASE_URL = process.env.SESSION_LINK_BASE_URL || process.env.FRONTEND_URL || "";

function normalizeOrigin(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function parseAllowedOrigins(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return true;
  }

  return allowedOrigins.some((allowed) => {
    if (allowed === origin) {
      return true;
    }

    if (allowed.startsWith("*.")) {
      try {
        const parsed = new URL(origin);
        const expectedSuffix = allowed.slice(1);
        return parsed.hostname.endsWith(expectedSuffix);
      } catch (_error) {
        return false;
      }
    }

    return false;
  });
}

function buildCorsOrigin(allowedOrigins) {
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return true;
  }

  return (origin, callback) => {
    const normalizedOrigin = normalizeOrigin(origin);

    if (isOriginAllowed(normalizedOrigin, allowedOrigins)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${normalizedOrigin || "unknown"}`));
  };
}

const allowedOrigins = parseAllowedOrigins(CORS_ORIGINS);
const corsOrigin = buildCorsOrigin(allowedOrigins);

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: corsOrigin,
    credentials: false,
  })
);

app.use(express.json({ limit: "100kb" }));

const publicDir = path.join(__dirname, "..", "public");

app.use(
  express.static(publicDir, {
    etag: true,
    lastModified: true,
    maxAge: NODE_ENV === "production" ? "1d" : 0,
    setHeaders: (response) => {
      if (NODE_ENV === "production") {
        response.setHeader("Cache-Control", "public, max-age=86400");
      } else {
        response.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  perMessageDeflate: {
    threshold: 1024,
  },
});

initializeSocket(io, {
  sessionLinkBase: SESSION_LINK_BASE_URL,
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`SecureChat server listening on http://localhost:${PORT} (${NODE_ENV})`);
  // eslint-disable-next-line no-console
  console.log(`SecureChat CORS origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(", ") : "*"}`);
});
