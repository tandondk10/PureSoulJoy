import AppHeader from "@/components/AppHeader";
import { C } from "@/constants/colors";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "capture" | "confirm" | "result";
type MealUnit = "g" | "cup" | "piece";

type MealItem = {
  id: string;
  name: string;
  quantity?: number;
  unit?: MealUnit;
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

  // 🔥 FOOD ALIASES (critical intelligence layer)
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

  // 🔥 STEP 5 — remove noise
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

  const items: MealItem[] = [];

  parts.forEach((part, i) => {
    const match = part.match(
      /^(\d+\.?\d*)?\s*(cups?|grams?|pieces?|slices?|g)?\s*(?:of\s+)?(.+)$/
    );

    if (!match) return;

    let qty = match[1] ? parseFloat(match[1]) : 1;
    let unitRaw = match[2] || "";
    let name = match[3]?.trim();

    if (!name || name.length < 2) return;

    // 🔥 APPLY ALIAS MAPPING
    // 🔥 SMART ALIAS MATCH (handles "chana salad", "saag curry", etc.)
    for (const key in FOOD_ALIASES) {
      if (name.includes(key)) {
        console.log(`🔁 Alias mapped: ${name} → ${FOOD_ALIASES[key]}`);
        name = FOOD_ALIASES[key];
        break;
      }
    }

    // 🔥 unit normalization
    let unit: MealUnit = "piece";
    if (unitRaw.startsWith("cup")) unit = "cup";
    else if (unitRaw.startsWith("g")) unit = "g";

    items.push({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      quantity: qty,
      unit,
    });
  });

  console.log("✅ PARSED ITEMS FINAL:", items);

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

      <TextInput
        value={item.name}
        onChangeText={(v) => onUpdate(item.id, { name: v })}
        style={{ flex: 1, color: C.text, fontSize: 15 }}
        placeholderTextColor={C.muted}
      />

      <TextInput
        value={String(item.quantity ?? 1)}
        onChangeText={(v) => onUpdate(item.id, { quantity: parseFloat(v) || 1 })}
        keyboardType="numeric"
        style={{
          color: C.accent,
          fontSize: 14,
          width: 34,
          textAlign: "center",
          marginHorizontal: 6,
        }}
      />
      <TouchableOpacity
        onPress={() => {
          const nextUnit =
            item.unit === "g"
              ? "cup"
              : item.unit === "cup"
                ? "piece"
                : "g";

          onUpdate(item.id, { unit: nextUnit });
        }}
        style={{
          backgroundColor: C.surfaceAlt,
          borderRadius: 6,
          paddingHorizontal: 6,
          paddingVertical: 3,
          marginHorizontal: 4,
        }}
      >
        <Text style={{ color: C.accent, fontSize: 12 }}>
          {item.unit === "g"
            ? "g"
            : item.unit === "cup"
              ? "cup"
              : "pc"}
        </Text>
      </TouchableOpacity>

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
}: {
  items: MealItem[];
  onChange: (items: MealItem[]) => void;
  onConfirm: () => void;
}) {
  const [addText, setAddText] = useState("");

  const updateItem = (id: string, patch: Partial<MealItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const deleteItem = (id: string) =>
    onChange(items.filter((item) => item.id !== id));

  const addItem = () => {
    const name = addText.trim();
    if (!name) return;

    onChange([
      ...items,
      {
        id: `${Date.now()}`,
        name: name.toLowerCase(),
        quantity: 1,
        unit: "piece",
      },
    ]);

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
          placeholder="+ Add item"
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
            Analyze Meal
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
      <FiberInsightSection nutrition={nutrition} />
      <ActionSection result={result} />
      <LearningSection result={result} />

      {improvements.length > 0 && (
        <ImprovementSection suggestions={improvements} />
      )}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MealMain() {

  // 🔥 1. HOOKS FIRST
  const router = useRouter();
  const { prefill } = useLocalSearchParams();
  const scrollRef = useRef<ScrollView>(null);

  // 🔥 2. STATE (MUST be before effects)
  const [stage, setStage] = useState<Stage>("capture");
  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [nutritionSummary, setNutritionSummary] = useState<NutritionSummary | null>(null);
  const [mealResult, setMealResult] = useState<MealResult | null>(null);
  const [improvements, setImprovements] = useState<string[]>([]);

  // 🔥 3. REFS
  const handledPrefillRef = useRef<string | null>(null);

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

    const items = extractMealItems(normalized);

    // ❌ parser fallback path
    if (items.length === 0) {
      console.log("⚠️ Prefill parsing failed");

      const fallbackItems = normalized
        .split(/\s*(?:,|and|with|&)\s*/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (fallbackItems.length === 0) {
        fallbackItems.push(normalized);
      }

      setMealItems(
        fallbackItems.map((name, i) => ({
          id: `${normalized}-${i}`,
          name,
          quantity: 1,
          unit: "piece",
        }))
      );

      setStage("confirm");

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      });

      handledPrefillRef.current = normalized;

      setTimeout(() => {
        router.setParams({ prefill: undefined });
      }, 0);

      return;
    }

    // ✅ normal flow
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

  const runMealProcessing = (items: MealItem[]) => {
    const nutrition = estimateNutrition(items);
    const result = computeResult(nutrition);
    const suggestions = computeImprovementSuggestions(nutrition);

    setMealItems(items);
    setNutritionSummary(nutrition);
    setMealResult(result);
    setImprovements(suggestions);
    setStage("result");

    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleBottomSend = () => {
    const text = bottomInput.trim();
    if (!text) return;

    console.log("👉 INPUT:", text);

    const items = extractMealItems(text);

    if (items.length === 0) {
      setMicStatus("Couldn't understand meal. Try again.");
      return;
    }

    // clear old result state
    setNutritionSummary(null);
    setMealResult(null);
    setImprovements([]);

    // send new meal into edit/confirm
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
        <View style={{ flex: 1, backgroundColor: C.bg }}>

          {/* ✅ HEADER (NON-SCROLLING) */}
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: "700", marginBottom: 4 }}>
              Meal
            </Text>

            <Text style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
              Meal Impact
            </Text>
          </View>

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

            {/* ✅ CONFIRM */}
            {stage === "confirm" && (
              <ConfirmStage
                items={mealItems}
                onChange={setMealItems}
                onConfirm={() => runMealProcessing(mealItems)}
              />
            )}

            {/* RESULT */}
            {stage === "result" && nutritionSummary && mealResult && (
              <ResultStage
                nutrition={nutritionSummary}
                result={mealResult}
                improvements={improvements}
                onReset={handleReset}
              />
            )}

          </ScrollView>

          {/* STATUS */}
          {micStatus && (
            <View style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ color: C.muted, fontSize: 13 }}>{micStatus}</Text>
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
            <TouchableOpacity
              onPress={() => router.back()}
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

            {/* Input */}
            <TextInput
              value={bottomInput}
              onChangeText={(text) => {
                setBottomInput(text);
                if (micStatus) setMicStatus(null);
              }}
              placeholder="Describe your meal…"
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
                Analyze
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}