// RADAR Chat Assistant
//
// A small, fully rule-based Q&A assistant — no external LLM call, no
// black-box model. That's a deliberate choice, not a shortcut: it's
// consistent with the product's core promise ("every score is
// explainable"), and it means the assistant's answers can never
// disagree with what the dashboard itself shows, because it's reading
// the exact same live data (attentionEngine's evidence, diffEngine's
// digest, alertsEngine's feed) rather than summarizing it through a
// second, separate model.

const {
  symbolState,
  ensureWatchlist,
  ensurePortfolio,
  ensureAlertFeed,
  feedView,
  seedDefaults,
} = require("./store");
const { SYMBOLS } = require("./symbols");
const { buildDigest } = require("./diffEngine");

const BAND_LABEL = {
  HIGH_ATTENTION: "High Attention",
  IMPORTANT: "Important",
  WORTH_WATCHING: "Worth Watching",
  NORMAL: "Normal",
};

// Sorted longest-symbol-first so "TATAMOTORS" matches before a
// coincidental shorter substring would.
const SYMBOLS_BY_LENGTH = [...SYMBOLS].sort((a, b) => b.symbol.length - a.symbol.length);

function findSymbolMention(text) {
  const upper = text.toUpperCase();

  for (const meta of SYMBOLS_BY_LENGTH) {
    const re = new RegExp(`\\b${meta.symbol}\\b`);
    if (re.test(upper)) return meta.symbol;
  }

  const lower = text.toLowerCase();
  for (const meta of SYMBOLS) {
    if (lower.includes(meta.name.toLowerCase())) return meta.symbol;
    const firstWord = meta.name.split(" ")[0].toLowerCase();
    if (firstWord.length > 3 && lower.includes(firstWord)) return meta.symbol;
  }

  return null;
}

function describeSymbol(symbol) {
  const st = symbolState.get(symbol);
  if (!st) return null;

  const band = BAND_LABEL[st.attention.band] || st.attention.band;
  const feed = feedView(symbol);

  let reply = `${symbol} (${st.meta.name}) is at ₹${st.price.toFixed(2)} — Attention Score ${st.attention.score}/100, ${band}.`;

  if (st.attention.evidence && st.attention.evidence.length > 0) {
    const [top, ...rest] = st.attention.evidence;
    reply += ` Main reason: ${top.text}.`;
    if (rest.length > 0) {
      reply += ` Also: ${rest.slice(0, 2).map((e) => e.text).join("; ")}.`;
    }
  } else {
    reply += " Nothing unusual — it's behaving within its own normal range right now.";
  }

  if (feed.status !== "FRESH") {
    reply += ` (This quote is currently ${feed.status.toLowerCase()}, ${feed.ageSeconds}s old.)`;
  }

  return reply;
}

function listByBand(userId, wantedBands) {
  const wl = ensureWatchlist(userId);
  const hits = [];
  for (const symbol of wl) {
    const st = symbolState.get(symbol);
    if (st && wantedBands.includes(st.attention.band)) {
      hits.push(`${symbol} (${st.attention.score})`);
    }
  }
  return hits;
}

function answerQuery(userId, rawMessage) {
  seedDefaults(userId);
  const message = String(rawMessage || "").trim();

  if (!message) {
    return {
      reply: 'Ask me about a stock (e.g. "How\'s TCS doing?"), your watchlist, or say "any alerts?"',
    };
  }

  const lower = message.toLowerCase();

  if (/^(hi|hello|hey|yo)\b/.test(lower)) {
    return {
      reply:
        "Hey — I'm the RADAR assistant. Ask me about a stock, your watchlist, or what needs your attention right now.",
    };
  }

  if (lower.includes("help") || lower.includes("what can you")) {
    return {
      reply:
        'I can tell you:\n' +
        '• "How\'s TCS doing?" — score, band, and the evidence behind it\n' +
        '• "Anything high attention?" — what\'s currently urgent on your watchlist\n' +
        '• "What\'s on my watchlist?" / "my portfolio"\n' +
        '• "Any alerts?" — your recent alert feed\n' +
        '• "Am I caught up?" — today\'s digest status',
    };
  }

  if (
    lower.includes("high attention") ||
    lower.includes("urgent") ||
    (lower.includes("important") && !lower.includes("importer"))
  ) {
    const highs = listByBand(userId, ["HIGH_ATTENTION"]);
    const importants = listByBand(userId, ["IMPORTANT"]);

    if (highs.length === 0 && importants.length === 0) {
      return { reply: "Nothing at HIGH ATTENTION or IMPORTANT on your watchlist right now — you're caught up." };
    }

    let reply = "";
    if (highs.length) reply += `HIGH ATTENTION: ${highs.join(", ")}. `;
    if (importants.length) reply += `IMPORTANT: ${importants.join(", ")}.`;
    return { reply: reply.trim() };
  }

  if (lower.includes("caught up") || lower.includes("digest") || lower.includes("anything new")) {
    const changes = buildDigest(userId);
    if (changes.length === 0) {
      return {
        reply: `You're caught up — ${ensureWatchlist(userId).size} stocks reviewed, nothing needs you right now.`,
      };
    }
    const names = changes.slice(0, 5).map((c) => c.symbol).join(", ");
    return {
      reply: `${changes.length} thing${changes.length === 1 ? "" : "s"} changed since you last checked: ${names}${
        changes.length > 5 ? ", …" : ""
      }.`,
    };
  }

  if (lower.includes("alert")) {
    const feed = ensureAlertFeed(userId);
    if (!feed || feed.length === 0) {
      return {
        reply: "No alerts fired yet. I'll let you know the moment something on your watchlist crosses one of your rules.",
      };
    }
    const lines = feed.slice(0, 3).map((a) => `${a.symbol}: ${a.reasons.join("; ")}`);
    return { reply: `Recent alerts —\n${lines.join("\n")}` };
  }

  if (lower.includes("watchlist")) {
    const wl = [...ensureWatchlist(userId)];
    if (wl.length === 0) return { reply: "Your watchlist is empty right now." };
    return { reply: `Watching: ${wl.join(", ")} (${wl.length} symbols).` };
  }

  if (lower.includes("portfolio") || lower.includes("holding")) {
    const pf = [...ensurePortfolio(userId)];
    if (pf.length === 0) return { reply: "No portfolio holdings marked yet." };
    return { reply: `Your holdings: ${pf.join(", ")}.` };
  }

  const symbol = findSymbolMention(message);
  if (symbol) {
    const reply = describeSymbol(symbol);
    return { reply: reply || `I don't have data on ${symbol} right now.`, symbol };
  }

  return {
    reply:
      'I didn\'t catch a stock or a question I recognize. Try a symbol name (e.g. "TCS"), or ask "any alerts?" / "what\'s high attention?" / "am I caught up?"',
  };
}

module.exports = { answerQuery };
