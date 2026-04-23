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

const KNOWN_PAIRS = new Set([
  "chicken salad",
  "egg curry",
  "fruit salad",
  "dal makhani",
  "fried rice",
  "mixed vegetables",
  "green tea",
  "black coffee",
  "brown rice",
  "whole wheat",
]);

const STANDALONE_FOODS = new Set([
  "rice", "eggs", "egg", "coffee", "tea", "coke", "pizza",
  "oats", "milk", "dal", "chicken", "fish", "bread", "paneer",
  "tofu", "roti", "chapati", "banana", "apple", "salad",
  "beans", "lentils", "idli", "dosa", "curd", "yogurt",
]);

function isLikelyFood(word: string): boolean {
  return STANDALONE_FOODS.has(word.toLowerCase());
}

export function cleanMealText(text: string): string {
  let result = text.toLowerCase();
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, "");
  }
  result = result.replace(/\band\b/gi, ",");
  result = result.replace(/,\s*,/g, ",");
  result = result.replace(/\s+/g, " ").trim().replace(/^[,\s]+|[,\s]+$/g, "");
  return result;
}

export function parseMealItems(text: string): string[] {
  const cleaned = cleanMealText(text);
  const segments = cleaned.split(",").map(s => s.trim()).filter(Boolean);
  const items: string[] = [];
  for (const segment of segments) {
    const words = segment.split(/\s+/).filter(Boolean);

    if (KNOWN_PAIRS.has(segment)) {
      items.push(segment);
    } else if (words.length === 2 && isLikelyFood(words[0]) && isLikelyFood(words[1])) {
      items.push(words[0], words[1]);
    } else if (words.length === 3 && words.every(isLikelyFood)) {
      items.push(...words);
    } else {
      items.push(segment);
    }
  }
  return items.filter(Boolean);
}
