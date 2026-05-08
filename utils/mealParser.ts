// ─────────────────────────────────────────────────────────────
// Meal Parser v2 — Robust, Low-Friction Input Handling
// Pipeline: clean → fixTypos → tokenize → buildItems → mergePhrases
// ─────────────────────────────────────────────────────────────

// ─── Filler removal ──────────────────────────────────────────
const FILLER_PATTERNS = [
  /\bi just had\b/gi,
  /\bi just ate\b/gi,
  /\bi had\b/gi,
  /\bi ate\b/gi,
  /\bate\b/gi,
  /\bhad\b/gi,
  /\bi consumed\b/gi,
  /\bconsumed\b/gi,
  /\bmy meal was\b/gi,
  /\bfor breakfast\b/gi,
  /\bfor lunch\b/gi,
  /\bfor dinner\b/gi,
  /\btoday\b/gi,
  /\bthis morning\b/gi,
  /\bjust now\b/gi,
];

// ─── Typo correction map ──────────────────────────────────────
const TYPO_MAP: Record<string, string> = {
  chxicken: "chicken",
  chiken: "chicken",
  chicen: "chicken",
  chciken: "chicken",
  yougurt: "yogurt",
  yoghurt: "yogurt",
  yougart: "yogurt",
  brocoli: "broccoli",
  brocolli: "broccoli",
  spinnach: "spinach",
  spinich: "spinach",
  bannana: "banana",
  banan: "banana",
  tomatoe: "tomato",
  potatoe: "potato",
  currry: "curry",
  daal: "dal",
  dahl: "dal",
};

// ─── Known multi-word food phrases ───────────────────────────
const KNOWN_PHRASES = new Set([
  "greek yogurt",
  "brown rice",
  "white rice",
  "basmati rice",
  "chicken salad",
  "chicken breast",
  "chicken curry",
  "boiled egg",
  "boiled eggs",
  "fried egg",
  "fried eggs",
  "scrambled eggs",
  "black tea",
  "green tea",
  "olive oil",
  "coconut oil",
  "sweet potato",
  "mixed vegetables",
  "egg white",
  "egg whites",
  "whole grain",
  "whole wheat",
  "peanut butter",
  "almond butter",
  "protein shake",
  "protein bar",
  "cottage cheese",
  "coconut milk",
  "almond milk",
  "oat milk",
  "dal rice",
  "dal chawal",
]);

// ─────────────────────────────────────────────────────────────
// STEP 1 — Clean text
// ─────────────────────────────────────────────────────────────
export function cleanMealText(text: string): string {
  let result = text.toLowerCase();

  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, "");
  }

  result = result.replace(/\band\b/gi, ",");
  result = result.replace(/,\s*,/g, ",");
  result = result.replace(/[,]+/g, " ");
  result = result.replace(/\s+/g, " ");
  result = result.trim();

  return result;
}

// ─────────────────────────────────────────────────────────────
// STEP 2 — Fix typos token by token
// ─────────────────────────────────────────────────────────────
function fixTypos(text: string): string {
  return text
    .split(" ")
    .map(w => TYPO_MAP[w] ?? w)
    .join(" ");
}

// ─────────────────────────────────────────────────────────────
// STEP 3 — Tokenize into food words and quantity tokens
// Handles: 100g, 200ml, 1 cup, 2 tbsp, plain numbers
// ─────────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text.match(/[a-zA-Z]+|\d+\s*(g|ml|cup|cups|tbsp|tsp)\b|\d+/gi) ?? [];
}

function isQuantity(token: string): boolean {
  return /\d/.test(token);
}

// ─────────────────────────────────────────────────────────────
// STEP 4 — Build structured items with quantity redistribution
//
// Rules:
//   - First qty encountered attaches to the current food
//   - Extra qtys (overflow) carry forward to the next food
//   - Qty before food: qty waits, then attaches when food appears
//   - No food at end with leftover qty: qty is dropped
// ─────────────────────────────────────────────────────────────
function buildItems(tokens: string[]): string[] {
  const items: string[] = [];
  let pendingWords: string[] = [];
  let pendingQty = "";
  const overflowQtys: string[] = [];

  const flush = () => {
    if (pendingWords.length === 0) return;
    const parts = pendingQty
      ? [...pendingWords, pendingQty]
      : pendingWords;
    items.push(parts.join(" ").trim());
    pendingWords = [];
    pendingQty = "";
  };

  for (const token of tokens) {
    const qty = isQuantity(token);

    if (qty) {
      const t = token.trim();
      if (!pendingQty) {
        pendingQty = t;
      } else {
        overflowQtys.push(t);
      }
    } else {
      // New food word — if we already have a food accumulating, flush it first
      if (pendingWords.length > 0) {
        flush();
        // First overflow qty becomes the qty for the next food
        pendingQty = overflowQtys.shift() ?? "";
      }
      pendingWords.push(token.trim());
    }
  }

  flush();
  return items.filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// STEP 5 — Merge known multi-word food phrases
//
// Only merges when the first item has no quantity (it's a bare
// food word) and the combined food name is in KNOWN_PHRASES.
// ─────────────────────────────────────────────────────────────
function extractFoodName(item: string): string {
  return item.replace(/\s+\d[\w\s]*$/, "").trim();
}

function hasQuantity(item: string): boolean {
  return /\d/.test(item);
}

function mergePhrases(items: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < items.length) {
    if (i + 1 < items.length && !hasQuantity(items[i])) {
      const foodA = items[i];
      const foodB = extractFoodName(items[i + 1]);
      const phrase = `${foodA} ${foodB}`;

      if (KNOWN_PHRASES.has(phrase)) {
        // Merge: prepend foodA to the next item (which may have a qty)
        result.push(`${foodA} ${items[i + 1]}`);
        i += 2;
        continue;
      }
    }
    result.push(items[i]);
    i++;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — parseMealItems
// ─────────────────────────────────────────────────────────────
export function parseMealItems(text: string): string[] {
  const cleaned = cleanMealText(text);
  const corrected = fixTypos(cleaned);
  const tokens = tokenize(corrected);
  const items = buildItems(tokens);
  return mergePhrases(items);
}

// PUBLIC API — normalizeQuery
// Deterministic normalization for grouping/scoring: lowercase, split on
// commas and "and", dedup, sort alphabetically, rejoin with ", ".
export function normalizeQuery(query: string): string {
  const items = query
    .toLowerCase()
    .split(/,|\band\b/)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(items)].sort().join(", ");
}
