import { parseMealItems } from "@/app/utils/mealParser";
import AppHeader from "@/components/AppHeader";
import SectionCard from "@/components/SectionCard";
import { C } from "@/constants/colors";
import useKeyboardVisible from "@/hooks/useKeyboardVisible";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "capture" | "confirm" | "processing" | "result";
type MealUnit = "g" | "ml" | "cup" | "piece";

type MealItem = {
  id: string;
  name: string;
  quantity?: number;
  unit?: MealUnit;
  inferred?: boolean;
};

type NutritionSummary = {
  carbs: number;
  protein: number;
  fats: number;
  fiber_total: number;
  fiber_soluble: number;
  fiber_insoluble: number;
};

type MealClassification = "light" | "heavy" | "very_heavy";

type MealResult = {
  classification: MealClassification;
  netCarbs: number;
  walkMinutes: number;
  waitHours: number;
  highSolubleFiber: boolean;
  glucoseImpact: "Low" | "Moderate" | "High";
  score: number;
  items: MealItem[];
  sequence: string;
  walk: string;
  nextMeal: string;
  lastMealGuidance?: string | null;
};

// ─── Food Database ────────────────────────────────────────────────────────────

type FoodEntry = {
  carbs: number;
  protein: number;
  fats: number;
  fiber_total: number;
  fiber_soluble: number;
};

const FOODS: Record<string, FoodEntry> = {
  rice: { carbs: 45, protein: 4, fats: 0.5, fiber_total: 0.6, fiber_soluble: 0.2 },
  "white rice": { carbs: 45, protein: 4, fats: 0.5, fiber_total: 0.6, fiber_soluble: 0.2 },
  "brown rice": { carbs: 45, protein: 5, fats: 2, fiber_total: 3.5, fiber_soluble: 0.8 },
  roti: { carbs: 18, protein: 3, fats: 2, fiber_total: 2, fiber_soluble: 0.5 },
  chapati: { carbs: 18, protein: 3, fats: 2, fiber_total: 2, fiber_soluble: 0.5 },
  bread: { carbs: 13, protein: 3, fats: 1, fiber_total: 1, fiber_soluble: 0.3 },
  pasta: { carbs: 40, protein: 7, fats: 1, fiber_total: 2, fiber_soluble: 0.5 },
  oats: { carbs: 27, protein: 5, fats: 3, fiber_total: 4, fiber_soluble: 2 },
  dosa: { carbs: 30, protein: 4, fats: 3, fiber_total: 1, fiber_soluble: 0.3 },
  idli: { carbs: 20, protein: 3, fats: 0.5, fiber_total: 1, fiber_soluble: 0.2 },
  naan: { carbs: 38, protein: 7, fats: 5, fiber_total: 2, fiber_soluble: 0.5 },

  chicken: { carbs: 0, protein: 25, fats: 5, fiber_total: 0, fiber_soluble: 0 },
  "chicken breast": { carbs: 0, protein: 30, fats: 3, fiber_total: 0, fiber_soluble: 0 },
  egg: { carbs: 1, protein: 6, fats: 5, fiber_total: 0, fiber_soluble: 0 },
  eggs: { carbs: 1, protein: 6, fats: 5, fiber_total: 0, fiber_soluble: 0 },
  fish: { carbs: 0, protein: 22, fats: 5, fiber_total: 0, fiber_soluble: 0 },
  salmon: { carbs: 0, protein: 25, fats: 12, fiber_total: 0, fiber_soluble: 0 },
  paneer: { carbs: 3, protein: 14, fats: 10, fiber_total: 0, fiber_soluble: 0 },
  tofu: { carbs: 2, protein: 10, fats: 5, fiber_total: 0.3, fiber_soluble: 0.1 },

  dal: { carbs: 20, protein: 9, fats: 1, fiber_total: 8, fiber_soluble: 2 },
  lentils: { carbs: 20, protein: 9, fats: 1, fiber_total: 8, fiber_soluble: 2 },
  beans: { carbs: 22, protein: 8, fats: 1, fiber_total: 7, fiber_soluble: 2 },
  "black beans": { carbs: 22, protein: 8, fats: 1, fiber_total: 7, fiber_soluble: 2 },
  chickpeas: { carbs: 27, protein: 9, fats: 3, fiber_total: 8, fiber_soluble: 2 },

  salad: { carbs: 3, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.5 },
  spinach: { carbs: 1, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.3 },
  broccoli: { carbs: 6, protein: 3, fats: 0, fiber_total: 5, fiber_soluble: 1 },
  carrot: { carbs: 7, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.7 },
  potato: { carbs: 37, protein: 4, fats: 0, fiber_total: 3, fiber_soluble: 1 },
  "sweet potato": { carbs: 26, protein: 2, fats: 0, fiber_total: 4, fiber_soluble: 1.2 },

  apple: { carbs: 25, protein: 0, fats: 0, fiber_total: 4, fiber_soluble: 1.5 },
  banana: { carbs: 27, protein: 1, fats: 0, fiber_total: 3, fiber_soluble: 0.6 },

  milk: { carbs: 12, protein: 8, fats: 5, fiber_total: 0, fiber_soluble: 0 },
  yogurt: { carbs: 10, protein: 10, fats: 3, fiber_total: 0, fiber_soluble: 0 },

  _default: { carbs: 20, protein: 5, fats: 3, fiber_total: 1, fiber_soluble: 0.3 },
};

// ─── Logic ────────────────────────────────────────────────────────────────────

function extractMealItems(text: string): MealItem[] {
  console.log("🔥 extractMealItems CALLED with:", text);

  const FOOD_ALIASES: Record<string, string> = {
    saag: "spinach",
    dal: "lentils",
    rajma: "beans",
    chana: "chickpeas",
    sabzi: "vegetable",
  };

  // 🔥 STEP 1 — normalize
  let cleaned = text.toLowerCase();

  // 🔥 STEP 2 — remove common sentence prefixes
  cleaned = cleaned.replace(/\b(i|we)\s+(had|ate)\b/g, "");

  // 🔥 STEP 3 — split multi-meal indicators
  cleaned = cleaned.replace(/\b(lunch|dinner|breakfast|snack)\b/g, ",");

  // 🔥 STEP 4 — normalize connectors → commas
  cleaned = cleaned.replace(/\b(and|with|plus|then|&)\b/g, ",");

  // 🔥 STEP 5 — remove noise (KEEP letters intact)
  cleaned = cleaned
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  console.log("🧹 CLEANED:", cleaned);

  // 🔥 STEP 6 — split into parts
  const parts = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const COMBINED_QTY = /^(\d+(?:\.\d+)?)(g|ml|cups?|pieces?|kg)$/i;
  const KNOWN_UNITS = new Set(["g", "ml", "cup", "cups", "piece", "pieces", "kg"]);

  const parseUnit = (raw: string): MealUnit | undefined => {
    const u = raw.toLowerCase();
    if (u === "g" || u === "gram" || u === "grams" || u === "kg") return "g";
    if (u === "ml") return "ml";
    if (u === "cup" || u === "cups") return "cup";
    if (u === "piece" || u === "pieces") return "piece";
    return undefined;
  };

  const items: MealItem[] = [];

  parts.forEach((part, i) => {
    const tokens = part.split(/\s+/).filter(Boolean);
    const nameTokens: string[] = [];
    let qty: number | undefined;
    let unit: MealUnit | undefined;

    let j = 0;
    while (j < tokens.length) {
      const tok = tokens[j];
      const next = tokens[j + 1];

      // Combined token: "100g", "200ml", "2piece"
      const combined = tok.match(COMBINED_QTY);
      if (combined) {
        if (qty == null) { qty = parseFloat(combined[1]); unit = parseUnit(combined[2]); }
        j++;
        continue;
      }

      // Separated tokens: "100 g", "200 ml"
      if (/^\d+(?:\.\d+)?$/.test(tok) && next && KNOWN_UNITS.has(next.toLowerCase())) {
        if (qty == null) { qty = parseFloat(tok); unit = parseUnit(next); }
        j += 2;
        continue;
      }

      nameTokens.push(tok);
      j++;
    }

    let name = nameTokens.join(" ").trim();

    // remove "of" prefix
    name = name.replace(/^of\s+/i, "").trim();

    if (!name || name.length < 2) return;

    // alias mapping
    for (const key in FOOD_ALIASES) {
      if (name.includes(key)) {
        console.log(`🔁 Alias mapped: ${name} → ${FOOD_ALIASES[key]}`);
        name = FOOD_ALIASES[key];
        break;
      }
    }

    items.push({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      ...(qty != null ? { quantity: qty } : {}),
      ...(unit != null ? { unit } : {}),
    });
  });

  return items;
}

function estimateNutrition(items: MealItem[]): NutritionSummary {
  let carbs = 0;
  let protein = 0;
  let fats = 0;
  let fiber_total = 0;
  let fiber_soluble = 0;

  for (const item of items) {
    const food = FOODS[item.name] ?? FOODS._default;
    const qty = item.quantity ?? 1;
    let scale = 1;

    if (item.unit === "g") {
      scale = qty / 100; // grams normalized
    } else if (item.unit === "cup") {
      scale = qty * 2; // 🔥 rough heuristic (1 cup ≈ 2 servings)
    } else {
      scale = qty; // pieces
    }
    carbs += food.carbs * scale;
    protein += food.protein * scale;
    fats += food.fats * scale;
    fiber_total += food.fiber_total * scale;
    fiber_soluble += food.fiber_soluble * scale;
  }

  const ft = Math.round(fiber_total * 10) / 10;
  const fs = Math.round(Math.min(fiber_soluble, fiber_total) * 10) / 10;

  return {
    carbs: Math.round(carbs),
    protein: Math.round(protein),
    fats: Math.round(fats),
    fiber_total: ft,
    fiber_soluble: fs,
    fiber_insoluble: Math.round(Math.max(0, ft - fs) * 10) / 10,
  };
}

function computeResult(n: NutritionSummary): MealResult {
  const netCarbs = Math.max(0, n.carbs - n.fiber_total);
  const highSolubleFiber = n.fiber_soluble >= 3;

  let classification: MealClassification;
  let walkMinutes = 0;
  let waitHours = 0;

  if (netCarbs < 40) {
    classification = "light";
  } else if (netCarbs <= 150) {
    classification = "heavy";
    walkMinutes = Math.round(15 + ((netCarbs - 40) / 110) * 15);
    waitHours = Math.round(2 + ((netCarbs - 40) / 110) * 2);

    if (highSolubleFiber) {
      walkMinutes = Math.max(10, walkMinutes - 5);
      waitHours = Math.max(2, waitHours - 1);
    }
  } else {
    classification = "very_heavy";
  }

  const glucoseImpact: "Low" | "Moderate" | "High" =
    classification === "light"
      ? "Low"
      : classification === "very_heavy"
        ? "High"
        : "Moderate";

  return {
    classification,
    netCarbs: Math.round(netCarbs),
    walkMinutes,
    waitHours,
    highSolubleFiber,
    glucoseImpact,
  };
}

function computeImprovementSuggestions(nutrition: NutritionSummary): string[] {
  const netCarbs = Math.max(0, nutrition.carbs - nutrition.fiber_total);
  const suggestions: string[] = [];

  if (netCarbs > 150) {
    suggestions.push("Consider splitting this meal or reducing carb load significantly.");
  } else if (netCarbs > 80) {
    suggestions.push("Reduce portion of high-carb items like rice, bread, pasta, or potatoes.");
  }

  if (nutrition.fiber_total < 3) {
    suggestions.push("Add more fiber through vegetables, salad, legumes, or beans.");
  }

  if (nutrition.fiber_soluble < 2) {
    suggestions.push("Add more soluble fiber through oats, lentils, beans, or chickpeas.");
  }

  if (nutrition.protein < 15) {
    suggestions.push("Add more protein such as eggs, chicken, paneer, tofu, or yogurt.");
  }

  if (nutrition.fats > 30) {
    suggestions.push("Reduce heavy fats from fried items, butter, cream, or excess oil.");
  }

  if (suggestions.length === 0) {
    suggestions.push("This meal already looks balanced. Small tweaks can improve it even more.");
  }

  return suggestions;
}

// ─── Inference helpers ────────────────────────────────────────────────────────

function inferUnit(name: string): MealUnit {
  const n = name.toLowerCase();
  if (/milk|juice|oil|coffee|tea/.test(n)) return "ml";
  if (/\beggs?\b|roti|chapati|apple|banana/.test(n)) return "piece";
  return "g";
}

function getDefaultPortion(name: string, unit: MealUnit): number {
  if (unit === "piece") return 1;
  if (unit === "ml") return 200;
  const n = name.toLowerCase();
  if (n.includes("rice")) return 150;
  if (n.includes("chicken")) return 120;
  if (n.includes("chips")) return 50;
  if (n.includes("beans")) return 100;
  return 100;
}

function applyInference(item: MealItem): MealItem {
  if (item.quantity != null && item.unit != null) return { ...item, inferred: false };
  const unit = item.unit ?? inferUnit(item.name);
  const quantity = item.quantity ?? getDefaultPortion(item.name, unit);
  return { ...item, quantity, unit, inferred: true };
}

function tokenSplit(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const isQtyToken = (i: number): number => {
    const tok = tokens[i];
    const next = tokens[i + 1];
    if (/^\d+(\.\d+)?(g|ml|kg|cups?|pieces?)$/i.test(tok)) return 1;
    if (/^\d+(\.\d+)?$/.test(tok) && next && /^(g|ml|kg|cups?|pieces?)$/i.test(next)) return 2;
    return 0;
  };

  let hasQty = false;
  for (let i = 0; i < tokens.length; i++) {
    if (isQtyToken(i)) { hasQty = true; break; }
  }
  if (!hasQty) return [segment];

  const result: string[] = [];
  let current: string[] = [];
  let currentHasQty = false;

  let i = 0;
  while (i < tokens.length) {
    const qtyLen = isQtyToken(i);

    if (qtyLen > 0) {
      if (current.length > 0 && !currentHasQty) {
        // Food-first: qty closes the current food phrase
        for (let j = 0; j < qtyLen; j++) current.push(tokens[i + j]);
        i += qtyLen;
        result.push(current.join(" "));
        current = [];
        currentHasQty = false;
      } else {
        // Qty-first OR current already has a qty → flush and start fresh
        if (current.length > 0) { result.push(current.join(" ")); current = []; }
        for (let j = 0; j < qtyLen; j++) current.push(tokens[i + j]);
        i += qtyLen;
        currentHasQty = true;
      }
    } else {
      current.push(tokens[i]);
      i++;
    }
  }

  if (current.length > 0) result.push(current.join(" "));

  return result;
}

function splitMealItems(text: string): string[] {
  return text
    .split(",")
    .flatMap((s) => s.split(/\s+and\s+/i))
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap(tokenSplit);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ItemRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: MealItem;
  onUpdate: (id: string, patch: Partial<MealItem>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: C.surface,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: C.accent,
          marginRight: 12,
        }}
      />

      <View style={{ flex: 1 }}>
        {console.log("UI item:", item.name) as any}
        <TextInput
          value={item.name}
          onChangeText={(v) => onUpdate(item.id, { name: v, inferred: false })}
          style={{ color: C.text, fontSize: 15 }}
          placeholderTextColor={C.muted}
          placeholder="e.g. Chicken 100 g"
        />
      </View>

      <TouchableOpacity
        onPress={() => onDelete(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={{ color: C.error, fontSize: 18, lineHeight: 20 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

function ConfirmStage({
  items,
  onChange,
  onConfirm,
  confirmLabel,
}: {
  items: MealItem[];
  onChange: (items: MealItem[]) => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const [addText, setAddText] = useState("");

  const updateItem = (id: string, patch: Partial<MealItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const deleteItem = (id: string) =>
    onChange(items.filter((item) => item.id !== id));

  const addItem = () => {
    const raw = addText.trim();
    if (!raw) return;
    onChange([...items, { id: `${Date.now()}`, name: raw, inferred: false }]);
    setAddText("");
  };

  return (
    <View>
      <Text style={{ color: C.text, fontSize: 20, fontWeight: "600", marginBottom: 4 }}>
        Edit your meal
      </Text>

      <Text style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>
        Detected {items.length} item{items.length !== 1 ? "s" : ""}
      </Text>

      <Text style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
        Add, remove, or adjust before analysis.
      </Text>

      {/* ⚠️ Trust fallback */}
      {items.length === 0 && (
        <Text style={{ color: C.error, marginBottom: 12 }}>
          Couldn't detect items clearly. Please add manually.
        </Text>
      )}

      {items.map((item) => (
        <ItemRow key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />
      ))}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: 4,
          marginBottom: 20,
        }}
      >
        <TextInput
          value={addText}
          onChangeText={setAddText}
          placeholder="e.g. Chicken 100 g"
          placeholderTextColor={C.muted}
          onSubmitEditing={addItem}
          returnKeyType="done"
          style={{
            flex: 1,
            backgroundColor: C.surface,
            borderRadius: 10,
            padding: 10,
            color: C.text,
            borderWidth: 1,
            borderColor: C.border,
            marginRight: 8,
            fontSize: 14,
          }}
        />

        <TouchableOpacity
          onPress={addItem}
          style={{
            backgroundColor: C.surface,
            borderRadius: 10,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderColor: C.borderAccent,
          }}
        >
          <Text style={{ color: C.accent, fontSize: 14 }}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={{ alignItems: "center", marginTop: 10 }}>
        <TouchableOpacity
          onPress={onConfirm}
          style={{
            backgroundColor: C.accent,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 24,
            alignItems: "center",

            minWidth: "50%",   // 🔥 key: not full width
            maxWidth: 320,     // 🔥 keeps it premium on large screens
          }}
        >
          <Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>
            {confirmLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ResultCard({
  title,
  children,
  accent = false,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: C.surfaceAlt,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: accent ? C.borderAccent : C.border,
      }}
    >
      <Text
        style={{
          color: C.accent,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Badge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: bg,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 6,
      }}
    >
      <Text style={{ color, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function FiberRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 6,
      }}
    >
      <Text style={{ color: C.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 14, fontWeight: "500" }}>
        {value}
        {unit}
      </Text>
    </View>
  );
}

function MealImpactSection({
  classification,
  glucoseImpact,
}: {
  classification: MealClassification;
  glucoseImpact: "Low" | "Moderate" | "High";
}) {
  const weightLabel =
    classification === "light" ? "Light" : classification === "heavy" ? "Heavy" : "Very Heavy";
  const weightColor =
    classification === "light" ? C.green : classification === "heavy" ? C.accent : C.error;
  const weightBg =
    classification === "light" ? C.greenDim : classification === "heavy" ? C.accentDim : C.errorDim;
  const impactColor =
    glucoseImpact === "Low" ? C.green : glucoseImpact === "High" ? C.error : C.accent;
  const impactBg =
    glucoseImpact === "Low" ? C.greenDim : glucoseImpact === "High" ? C.errorDim : C.accentDim;

  return (
    <ResultCard title="Meal Impact" accent>
      <Badge label={weightLabel} color={weightColor} bg={weightBg} />
      <Badge label={`${glucoseImpact} glucose impact`} color={impactColor} bg={impactBg} />
    </ResultCard>
  );
}

function FiberInsightSection({ nutrition }: { nutrition: NutritionSummary }) {
  const { fiber_total, fiber_soluble, fiber_insoluble } = nutrition;

  const interpretation =
    fiber_soluble >= 3
      ? "Fiber shield active → slows glucose absorption"
      : fiber_soluble >= 1.5
        ? "Moderate soluble fiber → some glucose buffering"
        : fiber_total < 2
          ? "Very low fiber → faster glucose spike likely"
          : "Low soluble fiber → faster glucose spike";

  return (
    <ResultCard title="Fiber Insight">
      <FiberRow label="Total fiber" value={fiber_total} unit="g" />
      <FiberRow label="Soluble" value={fiber_soluble} unit="g" />
      <FiberRow label="Insoluble" value={fiber_insoluble} unit="g" />

      <View
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: C.border,
        }}
      >
        <Text style={{ color: C.muted, fontSize: 13, fontStyle: "italic", lineHeight: 18 }}>
          {interpretation}
        </Text>
      </View>
    </ResultCard>
  );
}

function ActionSection({ result }: { result: MealResult }) {
  const { classification, walkMinutes, waitHours, highSolubleFiber } = result;

  let primaryLine: string;
  let secondaryLine: string | null = null;
  let modifier: string | null = null;

  if (classification === "light") {
    primaryLine = "You're good. No immediate action needed.";
  } else if (classification === "heavy") {
    primaryLine = `Wait ~${waitHours} hour${waitHours !== 1 ? "s" : ""} before next carb-heavy meal`;
    secondaryLine = `${walkMinutes}–${walkMinutes + 5} min walk helps`;

    if (highSolubleFiber) {
      modifier = "Fiber shield active → impact reduced";
    }
  } else {
    primaryLine = "Wait ~4–5 hours before next carb-heavy meal";
    secondaryLine = "45–60 min walk (can be split into two sessions)";
  }

  return (
    <ResultCard title="What to Do">
      <Text
        style={{
          color: C.text,
          fontSize: 16,
          fontWeight: "600",
          lineHeight: 22,
          marginBottom: secondaryLine ? 8 : 0,
        }}
      >
        {primaryLine}
      </Text>

      {secondaryLine && (
        <Text style={{ color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: modifier ? 10 : 0 }}>
          {secondaryLine}
        </Text>
      )}

      {modifier && (
        <View
          style={{
            marginTop: 2,
            backgroundColor: C.greenDim,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text style={{ color: C.green, fontSize: 13 }}>{modifier}</Text>
        </View>
      )}
    </ResultCard>
  );
}

function LearningSection({ result }: { result: MealResult }) {
  const { classification, highSolubleFiber } = result;
  const isGoodOutcome = classification === "light" || highSolubleFiber;

  if (!isGoodOutcome) return null;

  const label =
    classification === "light" && highSolubleFiber
      ? "Light meal · Fiber shield active"
      : classification === "light"
        ? "Light meal · Keep this pattern"
        : "Fiber shield active · Good food choice";

  return (
    <ResultCard title="Repeat What Works">
      <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{label}</Text>
    </ResultCard>
  );
}

function ImprovementSection({ suggestions }: { suggestions: string[] }) {
  return (
    <ResultCard title="How to Improve This Meal" accent>
      {suggestions.map((suggestion, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            marginBottom: i < suggestions.length - 1 ? 10 : 0,
          }}
        >
          <Text style={{ color: C.accent, fontSize: 14, marginRight: 8, marginTop: 1 }}>•</Text>
          <Text style={{ color: C.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
            {suggestion}
          </Text>
        </View>
      ))}
    </ResultCard>
  );
}

function ResultStage({
  nutrition,
  result,
  improvements,
  onReset,
}: {
  nutrition: NutritionSummary;
  result: MealResult;
  improvements: string[];
  onReset: () => void;
}) {
  return (
    <View>
      <MealImpactSection classification={result.classification} glucoseImpact={result.glucoseImpact} />
      <LearningSection result={result} />

      {improvements.length > 0 && (
        <ImprovementSection suggestions={improvements} />
      )}
    </View>
  );
}

// ─── Behavior derivation ─────────────────────────────────────────────────────

function deriveBehavior(nutrition: NutritionSummary, result: MealResult) {
  const fiber = nutrition.fiber_total;
  const protein = nutrition.protein;
  const netCarbs = result.netCarbs;

  let sequence = "Eat normally";
  if (netCarbs > 50) sequence = "Start with fiber → protein → carbs";
  else if (fiber >= 8) sequence = "Start with fiber, then rest";

  let walk = "No walk required";
  if (netCarbs > 60) walk = "Walk 25 minutes (Zone 2) within 30 minutes after this meal";
  else if (netCarbs > 40) walk = "Walk 15 minutes within 30 minutes after this meal";

  let hoursUntilNextMeal = 3;
  if (netCarbs > 70) hoursUntilNextMeal = 4;
  else if (fiber >= 10 && protein >= 20) hoursUntilNextMeal = 2;

  const now = new Date();
  const nextMealDate = new Date(now.getTime() + hoursUntilNextMeal * 60 * 60 * 1000);
  const hours = nextMealDate.getHours();
  const minutes = nextMealDate.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const nextMeal = `Your next meal is at ~${displayHour}:${minutes} ${ampm}`;

  let lastMealGuidance: string | null = null;
  if (now.getHours() >= 16) {
    lastMealGuidance = "If this is your last meal, finish ≥2–3 hours before sleep (ideally by ~7 PM)";
  }

  return { sequence, walk, nextMeal, lastMealGuidance };
}

// ─── Image placeholder ────────────────────────────────────────────────────────

const IMAGE_MEAL_PROFILES = [
  "rice, dal, salad",
  "chicken, bread, yogurt",
  "eggs, beans, vegetables",
  "paneer, roti, spinach",
  "oats, banana, milk",
  "fish, sweet potato, broccoli",
  "tofu, naan, chickpeas",
  "pasta, chicken breast, salad",
];

function mockMealFromImage(uri: string): string {
  const hash = uri.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return IMAGE_MEAL_PROFILES[hash % IMAGE_MEAL_PROFILES.length];
}

function formatMealItemDisplay(item: MealItem): string {
  const { name, quantity, unit } = item;
  if (quantity == null || unit == null) return name;
  if (unit === "cup") {
    const label = quantity === 1 ? "cup" : "cups";
    return `${quantity} ${label} ${name}`;
  }
  if (unit === "piece") {
    const label = quantity === 1 ? "piece" : "pieces";
    return `${quantity} ${label} ${name}`;
  }
  // g / ml — compact with no space
  return `${quantity}${unit} ${name}`;
}

async function normalizeItems(names: string[]): Promise<string[]> {
  const backendUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
  try {
    const res = await fetch(`${backendUrl}/normalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: names }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data?.items;
    if (!Array.isArray(result) || result.length !== names.length) {
      throw new Error("Invalid response from /normalize");
    }
    return result as string[];
  } catch (e) {
    console.warn("normalizeItems failed:", e);
    return names;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MealMain() {

  // 🔥 1. HOOKS FIRST
  const router = useRouter();
  const { prefill, image } = useLocalSearchParams();
  const scrollRef = useRef<ScrollView>(null);
  const isKeyboardVisible = useKeyboardVisible();

  // 🔥 2. STATE (MUST be before effects)
  const [stage, setStage] = useState<Stage>("capture");
  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [nutritionSummary, setNutritionSummary] = useState<NutritionSummary | null>(null);
  const [mealResult, setMealResult] = useState<MealResult | null>(null);
  const [improvements, setImprovements] = useState<string[]>([]);

  // 🔥 3. REFS
  const handledPrefillRef = useRef<string | null>(null);
  const handledImageRef = useRef<string | null>(null);

  // 🔥 4. DEBUG EFFECTS
  useEffect(() => {
    console.log("🧠 Stage changed:", stage);
  }, [stage]);

  useEffect(() => {
    console.log("🍽 Items updated:", mealItems);
  }, [mealItems]);

  useEffect(() => {
    console.log("🚨 MealMain mounted");
  }, []);

  // 🔥 5. PREFILL EFFECT
  useEffect(() => {
    const normalizedPrefillRaw =
      typeof prefill === "string"
        ? prefill
        : Array.isArray(prefill)
          ? prefill.join(", ")
          : null;

    if (!normalizedPrefillRaw) return;

    const normalized = normalizedPrefillRaw.toLowerCase();

    // 🔒 prevent duplicate handling
    if (handledPrefillRef.current === normalized) return;

    console.log("🔥 Prefill received:", normalized);

    // ✅ reset previous result state
    setNutritionSummary(null);
    setMealResult(null);
    setImprovements([]);

    // Split first, parse later (in runMealProcessing)
    const segments = parseMealItems(normalized);
    const items: MealItem[] = segments.map((seg, i) => ({
      id: `${Date.now()}-${i}`,
      name: seg.trim(),
      inferred: false,
    }));

    setMealItems(items);
    setStage("confirm");

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });

    handledPrefillRef.current = normalized;

    setTimeout(() => {
      router.setParams({ prefill: undefined });
    }, 0);

  }, [prefill]);

  // 🔥 IMAGE EFFECT
  useEffect(() => {
    const uri = typeof image === "string" ? image : null;
    if (!uri) return;
    if (handledImageRef.current === uri) return;

    const mockText = mockMealFromImage(uri);
    const segments = parseMealItems(mockText);
    const newItems: MealItem[] = segments.map((seg, i) => ({
      id: `${Date.now()}-${i}`,
      name: seg.trim(),
      inferred: false,
    }));
    console.log("UI items:", newItems.map((it) => it.name));
    handledImageRef.current = uri;
    setImageUri(uri);
    setMealItems(newItems);
    setStage("confirm");

    setTimeout(() => {
      router.setParams({ image: undefined });
    }, 0);
  }, [image]);

  const [bottomInput, setBottomInput] = useState("");
  const [micStatus, setMicStatus] = useState<string | null>(null);

  // ✅ RIGHT HERE
  const handleMicPress = () => {
    setMicStatus("Voice input not yet connected");
    setTimeout(() => setMicStatus(null), 2000);
  };

  const handleReset = () => {
    setStage("capture");
    setMealItems([]);
    setNutritionSummary(null);
    setMealResult(null);
    setImprovements([]);
    setBottomInput("");
    setMicStatus(null);
  };

  const resetAll = () => {
    setStage("capture");
    setMealItems([]);
    setNutritionSummary(null);
    setMealResult(null);
    setImprovements([]);
    setBottomInput("");
  };

  const runMealProcessing = async (items: MealItem[]) => {
    const rawNames = items.map((i) => i.name);
    console.log("RAW:", rawNames);
    const normalizedNames = await normalizeItems(rawNames);
    console.log("NORMALIZED:", normalizedNames);
    const safeNames =
      normalizedNames.length === rawNames.length ? normalizedNames : rawNames;
    const normalizedItems = items.map((item, idx) => ({
      ...item,
      name: safeNames[idx] || item.name,
    }));

    const parsedItems = normalizedItems.flatMap((item) => {
      if (item.quantity != null && item.unit) return [item];
      const segments = splitMealItems(item.name);
      return segments.flatMap((seg, i) => {
        const results = extractMealItems(seg);
        if (results.length > 0) {
          return results.map((r) => applyInference({ ...r, id: `${item.id}_${i}` }));
        }
        return [applyInference({ id: `${item.id}_${i}`, name: seg })];
      });
    });
    const nutrition = estimateNutrition(parsedItems);
    const result = computeResult(nutrition);
    const suggestions = computeImprovementSuggestions(nutrition);

    const score = result.classification === "light" ? 85
      : result.classification === "heavy" ? 60
        : 30;

    const behavior = deriveBehavior(nutrition, result);

    setMealItems(items);
    setNutritionSummary({ ...nutrition, score } as any);
    setMealResult({ ...result, score, ...behavior, items: parsedItems });
    setImprovements(suggestions);
    setStage("result");
  };

  const handleBottomSend = () => {
    const text = bottomInput.trim();
    if (!text) return;

    console.log("👉 INPUT:", text);

    const segments = parseMealItems(text);
    if (segments.length === 0) {
      setMicStatus("Couldn't understand meal. Try again.");
      return;
    }

    // clear old result state and any stale image
    handledImageRef.current = null;
    setImageUri(null);
    setNutritionSummary(null);
    setMealResult(null);
    setImprovements([]);

    const items: MealItem[] = segments.map((seg, i) => ({
      id: `${Date.now()}-${i}`,
      name: seg.trim(),
      inferred: false,
    }));

    console.log("UI items:", items.map((it) => it.name));

    setMealItems(items);
    setStage("confirm");
    setBottomInput("");
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: C.bg }}>
      <AppHeader />

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: C.bg }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/*<TouchableWithoutFeedback onPress={Keyboard.dismiss}>*/}
        <View style={{ flex: 1, backgroundColor: C.bg }}>

          {/* ✅ HEADER (NON-SCROLLING) */}
          {(() => {
            const STAGE_HEADER: Record<Stage, { title: string; subtitle: string }> = {
              capture: { title: "Describe your meal", subtitle: "Get instant insight before or after you eat" },
              confirm: { title: "Review your meal", subtitle: "Adjust anything before analysis" },
              processing: { title: "Analyzing your meal", subtitle: "Calculating impact and next steps" },
              result: { title: "Meal Impact", subtitle: "Here's what to do next" },
            };
            const { title, subtitle } = STAGE_HEADER[stage];
            return (
              <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
                <Text style={{ color: C.text, fontSize: 22, fontWeight: "700", marginBottom: 4 }}>
                  {title}
                </Text>
                <Text style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
                  {subtitle}
                </Text>
              </View>
            );
          })()}

          {/* ✅ SCROLL CONTENT ONLY */}
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 120,
            }}
          >

            {/* CAPTURE */}
            {stage === "capture" && (
              <Text
                style={{
                  color: C.muted,
                  textAlign: "center",
                  marginTop: 20,
                }}
              >
                Enter your meal or describe it…
              </Text>
            )}

            {/* PROCESSING (photo) */}
            {stage === "processing" && (
              <View style={{ alignItems: "center", marginTop: 40 }}>
                {imageUri && (
                  <Image
                    source={{ uri: imageUri }}
                    style={{ width: "100%", height: 220, borderRadius: 14, marginBottom: 20 }}
                    resizeMode="cover"
                  />
                )}
                <ActivityIndicator color={C.accent} size="large" />
                <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
                  {imageUri ? "Analyzing photo…" : "Analyzing meal…"}
                </Text>
              </View>
            )}

            {/* ✅ CONFIRM */}
            {stage === "confirm" && (
              <ConfirmStage
                items={mealItems}
                onChange={setMealItems}
                onConfirm={() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); setStage("processing"); void runMealProcessing(mealItems); }}
                confirmLabel={imageUri ? "Analyze Photo" : "Analyze Meal"}
              />
            )}

            {/* RESULT */}
            {stage === "result" && nutritionSummary && mealResult && (
              <>
                <SectionCard
                  title="Your Meal"
                  content={
                    mealResult?.items?.length > 0
                      ? mealResult.items
                        .map(formatMealItemDisplay)
                        .filter(Boolean)
                        .join(", ")
                      : "Meal not available"
                  }
                />
                <SectionCard
                  title="🔥 What To Do Now"
                  content={
                    `• ${(mealResult as any)?.sequence}\n` +
                    `• ${(mealResult as any)?.walk}\n` +
                    `• ${(mealResult as any)?.nextMeal}` +
                    ((mealResult as any)?.lastMealGuidance
                      ? `\n• ${(mealResult as any)?.lastMealGuidance}`
                      : "")
                  }
                />
                {(() => {
                  const n = nutritionSummary as any;
                  const content =
                    `Carbs: ${n.carbs_total ?? 0}g\n` +
                    `Protein: ${n.protein ?? 0}g\n` +
                    `Fat: ${n.fat_total ?? 0}g\n` +
                    `Saturated Fat: ${n.sat_fat ?? 0}g\n\n` +
                    `Fiber: ${n.fiber_total ?? 0}g\n` +
                    `  • Soluble: ${n.fiber_soluble ?? 0}g\n` +
                    `  • Insoluble: ${n.fiber_insoluble ?? 0}g`;
                  return <SectionCard title="Nutrition Summary" content={content} />;
                })()}
                {(() => {
                  const r = mealResult;
                  const weightLabel = r.classification === "light" ? "Light"
                    : r.classification === "heavy" ? "Heavy" : "Very Heavy";
                  return (
                    <SectionCard
                      title="Meal Impact"
                      content={`${weightLabel} meal • ${r.glucoseImpact} glucose impact`}
                    />
                  );
                })()}
                {(mealResult.classification === "light" || mealResult.highSolubleFiber) && (
                  <SectionCard
                    title="Learning"
                    content={
                      mealResult.classification === "light" && mealResult.highSolubleFiber
                        ? "Light meal · Fiber shield active"
                        : mealResult.classification === "light"
                          ? "Light meal · Keep this pattern"
                          : "Fiber shield active · Good food choice"
                    }
                  />
                )}
                {improvements.length > 0 && (
                  <SectionCard
                    title="Improvements"
                    content={improvements.map((s) => `• ${s}`).join("\n")}
                  />
                )}
                <SectionCard
                  title="Meal Score"
                  content={String((nutritionSummary as any)?.score ?? (mealResult as any)?.score ?? "--")}
                />
              </>
            )}

          </ScrollView>

          {/* STATUS */}
          {micStatus && (
            <View style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ color: C.muted, fontSize: 13 }}>{micStatus}</Text>
            </View>
          )}

          {!isKeyboardVisible && (
            <View style={{ alignItems: "center", marginVertical: 6 }}>
              <View style={{ width: 260 }}>
                <TouchableOpacity
                  onPress={() => router.push("/meal-capture")}
                  style={{
                    width: "100%",
                    backgroundColor: C.accent,
                    paddingVertical: 16,
                    borderRadius: 12,
                    alignItems: "center",
                    elevation: 2,
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "600", fontSize: 15 }}>
                    📸 Capture Another Meal
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 🔥 Bottom Bar */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: C.surface,
              borderRadius: 16,
              padding: 8,
              marginBottom: 10,
              marginHorizontal: 10,
              alignItems: "center",
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            {/* Home */}
            {!isKeyboardVisible ? (
              <TouchableOpacity
                onPress={() => router.replace("/")}
                style={{
                  marginRight: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: C.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 16 }}>🏠</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40, marginRight: 6 }} />
            )}

            {/* Input */}
            <TextInput
              value={bottomInput}
              onChangeText={(text) => {
                setBottomInput(text);
                if (micStatus) setMicStatus(null);
              }}
              placeholder="What's in your meal?"
              placeholderTextColor={C.muted}
              style={{
                flex: 1,
                color: C.text,
                paddingVertical: 6,
                paddingHorizontal: 4,
                fontSize: 14,
              }}
              onSubmitEditing={handleBottomSend}
              returnKeyType="send"
            />

            {/* Mic */}
            {!isKeyboardVisible ? (
              <TouchableOpacity
                onPress={handleMicPress}
                style={{
                  marginRight: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: C.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 16 }}>🎤</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40, marginRight: 6 }} />
            )}

            {/* Action */}
            <TouchableOpacity
              onPress={handleBottomSend}
              style={{
                backgroundColor: C.accent,
                paddingHorizontal: 16,
                paddingVertical: 9,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "600", fontSize: 13 }}>
                Send
              </Text>
            </TouchableOpacity>
          </View>

        </View>
        {/*</TouchableWithoutFeedback>*/}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}