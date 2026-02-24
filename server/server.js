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

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
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
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  perMessageDeflate: {
    threshold: 1024,
  },
});

initializeSocket(io);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SecureChat server listening on http://localhost:${PORT} (${NODE_ENV})`);
});
