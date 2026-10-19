/**
 * server.js — Entrypoint for "The Gatekeepers" POC.
 *
 * Run with:  node server.js
 * Requiring ./src/db creates gatekeeper.db, the tables, and the seed users.
 */

require("dotenv").config();
const express = require("express");
const path = require("path");

require("./src/db"); // initializes the database (schema + seed data)

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // the UI at /

// Routes
app.use("/api", require("./src/routes/users")); // GET  /api/users, /api/users/:id
app.use("/api", require("./src/routes/flags")); // POST /api/flags
app.use("/api", require("./src/routes/vouch")); // POST /api/vouch
app.use("/api", require("./src/routes/chat")); // POST /api/chat

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Gatekeepers is running at http://localhost:${PORT}`);
});
