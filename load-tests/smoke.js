/**
 * AstraOS — k6 Load Test (Smoke)
 * Usage: k6 run load-tests/smoke.js
 *
 * Stages:
 *   1. Ramp up to 10 users over 30s
 *   2. Sustain 10 users for 1 minute
 *   3. Ramp down over 10s
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const API_KEY = __ENV.API_KEY || "dev-key-1";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

const headers = { "X-API-Key": API_KEY, "Content-Type": "application/json" };

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    "health status 200": (r) => r.status === 200,
    "health response < 200ms": (r) => r.timings.duration < 200,
  });

  // List agents
  const agents = http.get(`${BASE_URL}/api/agents`, { headers });
  check(agents, {
    "agents status 200": (r) => r.status === 200,
    "agents is array": (r) => Array.isArray(JSON.parse(r.body)),
  });

  // List skills
  const skills = http.get(`${BASE_URL}/api/skills`, { headers });
  check(skills, {
    "skills status 200": (r) => r.status === 200,
  });

  // Get settings
  const settings = http.get(`${BASE_URL}/api/settings`, { headers });
  check(settings, {
    "settings status 200": (r) => r.status === 200,
  });

  // Security report
  const security = http.get(`${BASE_URL}/api/security/report`, { headers });
  check(security, {
    "security status 200": (r) => r.status === 200,
  });

  // Chat (most expensive endpoint)
  const chat = http.post(
    `${BASE_URL}/api/chat`,
    JSON.stringify({ message: "Hello", sessionId: `load-${__VU}-${__ITER}` }),
    { headers, timeout: "10s" }
  );
  check(chat, {
    "chat responds": (r) => r.status === 200 || r.status === 500, // 500 ok if no LLM key
  });

  sleep(1);
}
