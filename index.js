// ============================================================
// Galaxy AI — All-in-One Cloudflare Worker
// ============================================================

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const SYSTEM_PROMPT = "မင်းက Galaxy AI ဖြစ်တယ်။ မြန်မာစကားကို ကျွမ်းကျင်စွာ ပြောဆိုနိုင်ပြီး လူသားဆန်စွာ အဖြေပေးရမယ်။ စကားပြောရင် 'ကျွန်တော်/ကျွန်မ' သုံးပြီး ယဉ်ကျေးပါစေ။ ရာသီဥတု၊ ပုံဆွဲတာနဲ့ Google Search တွေကိုလည်း ကျွမ်းကျင်စွာ အသုံးပြုနိုင်ပါတယ်။";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
  };
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ── Weather Logic ──────────────────────────────────────────
async function getQuickWeather() {
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=16.8661&longitude=96.1951&current=temperature_2m,weather_code&timezone=auto");
    const data = await res.json();
    return `Current Temp: ${data.current.temperature_2m}°C`;
  } catch { return "Weather service unavailable"; }
}

// ── Main Chat with Function Calling ─────────────────────────
async function handleChat(request, env) {
  const body = await request.json();
  const { message, history = [] } = body;

  if (!env.GEMINI_API_KEY) return jsonResponse({ error: "API Key missing" });

  const contents = history.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
  
  // လက်ရှိအချိန်ကို AI သိအောင် context ထည့်ပေးခြင်း
  const timeContext = `\n[System Note: Current time is ${new Date().toLocaleString()}]`;
  contents.push({ role: "user", parts: [{ text: message + timeContext }] });

  // Gemini 3 Flash API Call
  const url = `${GEMINI_BASE}/gemini-3-flash-preview:generateContent?key=${env.GEMINI_API_KEY}`;
  
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    tools: [
      { google_search: {} } // Google Search Grounding ကို Chat ထဲမှာတင် သုံးဖို့
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  let reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "နားမလည်လိုက်ဘူးဗျာ၊ နောက်တစ်ခေါက် ပြန်မေးပေးမလား။";

  // Photo Generation Logic (စာသားထဲမှာ 'ပုံဆွဲပေး' ပါရင် trigger လုပ်မယ်)
  let imageUrl = null;
  if (message.includes("ပုံဆွဲ") || message.includes("draw") || message.includes("image")) {
    const seed = Math.floor(Math.random() * 100000);
    imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(message)}?seed=${seed}&width=512&height=512&nologo=true`;
    reply += "\n\n(ကျွန်တော် ပုံလေး ဆွဲပေးထားပါတယ်ဗျ!)";
  }

  return jsonResponse({ reply, image_url: imageUrl, model: "gemini-3-flash-preview" });
}

// ── Router ──────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    const auth = request.headers.get("X-App-Password") === (env.APP_PASSWORD || "galaxy123");

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!auth) return jsonResponse({ error: "Unauthorized" }, 401);
      return handleChat(request, env);
    }

    if (url.pathname === "/api/weather") return jsonResponse({ weather: await getQuickWeather() });

    return new Response("Galaxy AI API is Live", { status: 200 });
  }
};
