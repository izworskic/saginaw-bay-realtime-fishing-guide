const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

async function maybeGenerateCaptainNote(snapshot) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "", 10) || 12000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const prompt = buildPrompt(snapshot);
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 180,
        messages: [
          {
            role: "system",
            content: "You are a conservative Saginaw Bay fishing advisor. Be specific, safety-first, and avoid hype or false precision.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    const body = await response.json();
    const text = extractText(body);
    if (!text) {
      return null;
    }

    return {
      text,
      model,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(snapshot) {
  const topZone = snapshot?.bestSetup?.name || "Unknown";
  const bayCall = snapshot?.bayCall?.label || "Unknown";
  const confidence = snapshot?.bayCall?.confidenceLabel || "unknown";
  const conditions = snapshot?.conditions || {};
  const reasons = (snapshot?.bayCall?.rationale || []).slice(0, 4);
  const fishReports = snapshot?.reports?.sourceSummary || "No report summary available.";

  return [
    "Write one short 'Captain Note' for anglers heading to Saginaw Bay today.",
    "Requirements:",
    "- 2-3 sentences max.",
    "- Include one safety caution.",
    "- Include one practical launch/zone focus.",
    "- Plain language, no percentages.",
    "",
    `Bay call: ${bayCall}`,
    `Top zone: ${topZone}`,
    `Confidence: ${confidence}`,
    `Wind: ${conditions.windMph ?? "?"} mph ${conditions.windDirectionCardinal || ""}`.trim(),
    `Waves: ${conditions.waveFt ?? "?"} ft`,
    `Water temp: ${conditions.waterTempF ?? "?"} F`,
    `Reports: ${fishReports}`,
    `Key rationale: ${reasons.join(" | ")}`,
  ].join("\n");
}

function extractText(responseBody) {
  const direct = responseBody?.choices?.[0]?.message?.content;
  if (typeof direct === "string") {
    return direct.trim();
  }

  if (Array.isArray(direct)) {
    const joined = direct
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.text || entry?.content || "";
      })
      .join(" ")
      .trim();
    if (joined) {
      return joined;
    }
  }

  return null;
}

module.exports = {
  maybeGenerateCaptainNote,
};
