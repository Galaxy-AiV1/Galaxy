// ============================================================
// Galaxy AI — Cloudflare Worker
// ============================================================
// Setup:
//   1. Deploy this file to Cloudflare Workers
//   2. Set environment variables (Secrets):
//      - GEMINI_API_KEY  : your Google Gemini API key
//      - APP_PASSWORD    : any password you choose to protect your app
//   3. Update WORKER_URL in index.html with your worker's URL
// ============================================================

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const SYSTEM_PROMPT = "You are Galaxy AI, a brilliant and helpful AI assistant. Be clear, concise, and friendly. Use markdown formatting for code, lists, and emphasis when appropriate.";

// ── CORS Helper ──────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ── Password Check ───────────────────────────────────────────
function checkAuth(request, env) {
  const password = request.headers.get("X-App-Password") || "";
  const correct = env.APP_PASSWORD || "galaxy123";
  return password === correct;
}

// ── Weather Code Map ─────────────────────────────────────────
const WEATHER_CODES = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Light showers", 81: "Showers", 95: "Thunderstorm",
};

// ── /api/chat ────────────────────────────────────────────────
async function handleChat(request, env) {
  const body = await request.json();
  const { message, history = [], model = "gemini-3-flash-preview" } = body;

  if (!message) return errorResponse("message is required");
  if (!env.GEMINI_API_KEY) return errorResponse("GEMINI_API_KEY not configured", 500);

  // Build contents from history + new message
  const contents = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: message }] });

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return errorResponse(err.error?.message || "Gemini API error", 500);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
  return jsonResponse({ reply, model });
}

// ── /api/search ──────────────────────────────────────────────
async function handleSearch(request, env) {
  const body = await request.json();
  const { query } = body;
  if (!query) return errorResponse("query is required");
  if (!env.GEMINI_API_KEY) return errorResponse("GEMINI_API_KEY not configured", 500);

  // Fetch DuckDuckGo instant answers
  let context = "";
  const sources = [];
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgUrl, { headers: { "User-Agent": "GalaxyAI/1.0" } });
    const ddg = await ddgRes.json();
    if (ddg.Abstract) {
      context += `Abstract: ${ddg.Abstract}\n`;
      if (ddg.AbstractURL) sources.push({ title: ddg.AbstractSource || "Source", url: ddg.AbstractURL });
    }
    if (ddg.Answer) context += `Answer: ${ddg.Answer}\n`;
    for (const topic of (ddg.RelatedTopics || []).slice(0, 3)) {
      if (topic.Text && topic.FirstURL) {
        context += `- ${topic.Text.slice(0, 200)}\n`;
        sources.push({ title: topic.Text.slice(0, 60), url: topic.FirstURL });
      }
    }
  } catch (_) { /* DuckDuckGo failed, use Gemini only */ }

  const today = new Date().toDateString();
  const prompt = `Today is ${today}. Search query: "${query}"\n\n${context ? "Web context:\n" + context + "\n" : ""}Provide a clear, accurate, markdown-formatted answer. Be concise but complete.`;

  const url = `${GEMINI_BASE}/gemini-2.5-flash-preview-05-20:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });

  const data = await res.json();
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No answer found";
  return jsonResponse({ answer, sources: sources.slice(0, 5), query });
}

// ── /api/image ───────────────────────────────────────────────
async function handleImage(request, env) {
  const body = await request.json();
  const { prompt, width = 512, height = 512 } = body;
  if (!prompt) return errorResponse("prompt is required");

  const w = Math.min(Math.max(width, 256), 1024);
  const h = Math.min(Math.max(height, 256), 1024);
  const seed = Math.abs(prompt.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 100000;
  const image_url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;

  return jsonResponse({ image_url, prompt, width: w, height: h });
}

// ── /api/weather ─────────────────────────────────────────────
async function handleWeather(request, env) {
  let lat = 16.8661, lon = 96.1951, city = "Yangon", country = "Myanmar", tz = "Asia/Rangoon";

  // Get IP-based location
  try {
    const ipRes = await fetch("https://ipapi.co/json/", { headers: { "User-Agent": "GalaxyAI/1.0" } });
    const ip = await ipRes.json();
    lat = ip.latitude || lat;
    lon = ip.longitude || lon;
    city = ip.city || city;
    country = ip.country_name || country;
    tz = ip.timezone || tz;
  } catch (_) {}

  // Get weather from Open-Meteo (free, no key)
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`;
  const wRes = await fetch(wUrl);
  const wData = await wRes.json();
  const cur = wData.current || {};

  const code = cur.weather_code || 0;
  return jsonResponse({
    city, country, timezone: tz,
    temperature: Math.round(cur.temperature_2m * 10) / 10,
    feels_like: Math.round(cur.apparent_temperature * 10) / 10,
    humidity: Math.round(cur.relative_humidity_2m || 0),
    wind_speed: Math.round(cur.wind_speed_10m * 10) / 10,
    condition: WEATHER_CODES[code] || "Unknown",
    condition_code: code,
  });
}

// ── Main Export ──────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Serve index.html at root (no auth needed)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // In production: serve from KV or inline HTML
      // For now, redirect users to open index.html locally
      return new Response(
        `<html><body style="font:14px sans-serif;padding:2rem;background:#07080f;color:#e8eaf0;text-align:center">
          <h2>Galaxy AI Worker is running! ✓</h2>
          <p>Open <code>index.html</code> in your browser and set <code>WORKER_URL</code> to this worker's URL.</p>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html", ...corsHeaders() } }
      );
    }

    // Auth check for API routes
    if (url.pathname.startsWith("/api/")) {
      if (!checkAuth(request, env)) {
        return jsonResponse({ error: "Wrong password" }, 401);
      }
    }

    // Route API calls
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname === "/api/search" && request.method === "POST") return handleSearch(request, env);
    if (url.pathname === "/api/image" && request.method === "POST") return handleImage(request, env);
    if (url.pathname === "/api/weather" && request.method === "GET") return handleWeather(request, env);

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};
