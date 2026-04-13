import { C } from "@/constants/colors";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { log } from "../utils/instrumentation";
import { ImproveMealBody } from "./ImproveMeal";

  // ─── Types ────────────────────────────────────────────────────────────────────

  type Stage = "capture" | "result";
  type IntentId = "analyze_meal" | "improve_meal" | "build_meal" | "what_now";
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

  // ─── Colors ───────────────────────────────────────────────────────────────────


  const labelMap = {
    build_meal: "Build",
    what_now: "What now",
  };

  // ─── Food Database ────────────────────────────────────────────────────────────
  // Per-unit values: 1 cup cooked / 1 piece / per 100g when unit is "g"
  // NOTE: For production, replace with a backend nutrition API call.

  type FoodEntry = {
    carbs: number;
    protein: number;
    fats: number;
    fiber_total: number;
    fiber_soluble: number;
  };

  const FOODS: Record<string, FoodEntry> = {
    // Grains
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
    // Proteins
    chicken: { carbs: 0, protein: 25, fats: 5, fiber_total: 0, fiber_soluble: 0 },
    "chicken breast": { carbs: 0, protein: 30, fats: 3, fiber_total: 0, fiber_soluble: 0 },
    egg: { carbs: 1, protein: 6, fats: 5, fiber_total: 0, fiber_soluble: 0 },
    eggs: { carbs: 1, protein: 6, fats: 5, fiber_total: 0, fiber_soluble: 0 },
    fish: { carbs: 0, protein: 22, fats: 5, fiber_total: 0, fiber_soluble: 0 },
    salmon: { carbs: 0, protein: 25, fats: 12, fiber_total: 0, fiber_soluble: 0 },
    paneer: { carbs: 3, protein: 14, fats: 10, fiber_total: 0, fiber_soluble: 0 },
    tofu: { carbs: 2, protein: 10, fats: 5, fiber_total: 0.3, fiber_soluble: 0.1 },
    // Legumes
    dal: { carbs: 20, protein: 9, fats: 1, fiber_total: 8, fiber_soluble: 2 },
    lentils: { carbs: 20, protein: 9, fats: 1, fiber_total: 8, fiber_soluble: 2 },
    beans: { carbs: 22, protein: 8, fats: 1, fiber_total: 7, fiber_soluble: 2 },
    "black beans": { carbs: 22, protein: 8, fats: 1, fiber_total: 7, fiber_soluble: 2 },
    chickpeas: { carbs: 27, protein: 9, fats: 3, fiber_total: 8, fiber_soluble: 2 },
    // Vegetables
    salad: { carbs: 3, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.5 },
    spinach: { carbs: 1, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.3 },
    broccoli: { carbs: 6, protein: 3, fats: 0, fiber_total: 5, fiber_soluble: 1 },
    carrot: { carbs: 7, protein: 1, fats: 0, fiber_total: 2, fiber_soluble: 0.7 },
    potato: { carbs: 37, protein: 4, fats: 0, fiber_total: 3, fiber_soluble: 1 },
    "sweet potato": { carbs: 26, protein: 2, fats: 0, fiber_total: 4, fiber_soluble: 1.2 },
    // Fruits
    apple: { carbs: 25, protein: 0, fats: 0, fiber_total: 4, fiber_soluble: 1.5 },
    banana: { carbs: 27, protein: 1, fats: 0, fiber_total: 3, fiber_soluble: 0.6 },
    // Dairy
    milk: { carbs: 12, protein: 8, fats: 5, fiber_total: 0, fiber_soluble: 0 },
    yogurt: { carbs: 10, protein: 10, fats: 3, fiber_total: 0, fiber_soluble: 0 },
    // Fallback
    _default: { carbs: 20, protein: 5, fats: 3, fiber_total: 1, fiber_soluble: 0.3 },
  };

  // ─── Logic ────────────────────────────────────────────────────────────────────

  const MEAL_KEYWORDS = ["analyze", "meal", "food", "ate", "eat"];

  function detectIntent(text: string): IntentId | null {
    const lower = text.toLowerCase();
    if (MEAL_KEYWORDS.some((k) => lower.includes(k))) return "analyze_meal";
    return null;
  }

  function extractMealItems(text: string): MealItem[] {
    const parts = text
      .split(/,|\band\b|\n/i)
      .map((s) => s.trim())
      .filter(Boolean);

    return parts.map((part, i) => {
      // Match: "2 cups rice" | "100g oats" | "1 piece chicken" | "rice"
      const m = part.match(
        /^(\d+\.?\d*)?\s*(cup|cups|g|gram|grams|piece|pieces|slice|slices)?\s*(.+)$/i
      );
      if (!m) {
        return { id: String(i), name: part.toLowerCase(), quantity: 1, unit: "piece" as MealUnit };
      }
      const qty = m[1] ? parseFloat(m[1]) : 1;
      const rawUnit = (m[2] || "").toLowerCase();
      const name = m[3].trim().toLowerCase();

      let unit: MealUnit = "piece";
      if (rawUnit.startsWith("cup")) unit = "cup";
      else if (rawUnit.startsWith("g") || rawUnit.startsWith("gram")) unit = "g";

      return { id: String(i), name, quantity: qty, unit };
    });
  }

  function estimateNutrition(items: MealItem[]): NutritionSummary {
    let carbs = 0, protein = 0, fats = 0, fiber_total = 0, fiber_soluble = 0;

    for (const item of items) {
      const food = FOODS[item.name] ?? FOODS._default;
      const qty = item.quantity ?? 1;
      // For grams: base values are per-piece (~100g equivalent), scale accordingly
      const scale = item.unit === "g" ? qty / 100 : qty;

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
      // Fiber modifier: high soluble fiber reduces recovery slightly
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
          : highSolubleFiber
            ? "Moderate"
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

  // ─── Sub-components ───────────────────────────────────────────────────────────

  function ChipBar({
    selected,
    onSelect,
  }: {
    selected: IntentId | null;
    onSelect: (id: IntentId) => void;
  }) {
    const chips: { id: IntentId; label: string }[] = [
      { id: "analyze_meal", label: "Analyze" },
      { id: "improve_meal", label: "Improve" },
      { id: "build_meal", label: "Build" },
      { id: "what_now", label: "What now" },
    ];

    return (
      <View style={{ flexDirection: "row", marginBottom: 20 }}>
        {chips.map(({ id, label }) => {
          const isSelected = selected === id;
          const hasSel = selected !== null;
          return (
            <TouchableOpacity
              key={id}
              onPress={() => onSelect(id)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                marginRight: 8,
                backgroundColor: isSelected ? C.accent : C.surface,
                borderWidth: 1,
                borderColor: isSelected ? C.accent : C.border,
                opacity: hasSel && !isSelected ? 0.35 : 1,
              }}
            >
              <Text
                style={{
                  color: isSelected ? "#000" : C.text,
                  fontWeight: isSelected ? "600" : "400",
                  fontSize: 13,
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  function CaptureStage({ onSubmit }: { onSubmit: (text: string) => void }) {
    const [text, setText] = useState("");
    const canSubmit = text.trim().length > 0;

    return (
      <View>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: "600", marginBottom: 6 }}>
          What did you eat?
        </Text>
        <Text style={{ color: C.muted, fontSize: 14, marginBottom: 20, lineHeight: 20 }}>
          List items with rough amounts — commas are fine
        </Text>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="e.g. 2 cups rice, chicken curry, salad"
          placeholderTextColor={C.muted}
          multiline
          style={{
            backgroundColor: C.surface,
            borderRadius: 14,
            padding: 16,
            color: C.text,
            minHeight: 100,
            borderWidth: 1,
            borderColor: C.border,
            marginBottom: 16,
            fontSize: 15,
            lineHeight: 22,
            textAlignVertical: "top",
          }}
        />

        <TouchableOpacity
          onPress={() => canSubmit && onSubmit(text)}
          style={{
            backgroundColor: canSubmit ? C.accent : C.surface,
            borderRadius: 14,
            paddingVertical: 15,
            alignItems: "center",
            borderWidth: 1,
            borderColor: canSubmit ? C.accent : C.border,
          }}
        >
          <Text
            style={{
              color: canSubmit ? "#000" : C.muted,
              fontWeight: "600",
              fontSize: 15,
            }}
          >
            Analyze Meal
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

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
        <Text style={{ color: C.muted, fontSize: 12, width: 28 }}>
          {item.unit === "g" ? "g" : item.unit === "cup" ? "cup" : "pc"}
        </Text>
        <TouchableOpacity onPress={() => onDelete(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
      onChange([...items, { id: `${Date.now()}`, name: name.toLowerCase(), quantity: 1, unit: "piece" }]);
      setAddText("");
    };

    return (
      <View>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: "600", marginBottom: 4 }}>
          Detected Meal
        </Text>
        <Text style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
          Edit items, then analyze
        </Text>

        {items.map((item) => (
          <ItemRow key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />
        ))}

        {/* Add item */}
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

        <TouchableOpacity
          onPress={onConfirm}
          style={{
            backgroundColor: C.accent,
            borderRadius: 14,
            paddingVertical: 15,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>
            Analyze This Meal
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Result sub-components ────────────────────────────────────────────────────

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

  function ResultStage({
    nutrition,
    result,
    onReset,
  }: {
    nutrition: NutritionSummary;
    result: MealResult;
    onReset: () => void;
  }) {
    return (
      <View>
        <MealImpactSection
          classification={result.classification}
          glucoseImpact={result.glucoseImpact}
        />
        <FiberInsightSection nutrition={nutrition} />
        <ActionSection result={result} />
        <LearningSection result={result} />

        <TouchableOpacity
          onPress={onReset}
          style={{
            marginTop: 4,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 14,
            paddingVertical: 13,
            alignItems: "center",
          }}
        >
          <Text style={{ color: C.muted, fontSize: 14 }}>Analyze another meal</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Main Component ───────────────────────────────────────────────────────────

  export default function AnalyzeMeal() {

    const router = useRouter(); //
    const params = useLocalSearchParams();

    const [stage, setStage] = useState<Stage>("capture");

    const initialIntent =
      typeof params?.intent === "string"
        ? (params.intent as IntentId)
        : "analyze_meal"; // default

    const [selectedIntent, setSelectedIntent] = useState<IntentId | null>(
      initialIntent
    );

    const [mealItems, setMealItems] = useState<MealItem[]>([]);
    const [nutritionSummary, setNutritionSummary] = useState<NutritionSummary | null>(null);
    const [mealResult, setMealResult] = useState<MealResult | null>(null);
    const [bottomInput, setBottomInput] = useState("");
    const [micStatus, setMicStatus] = useState<string | null>(null);

    useEffect(() => {
      if (typeof params?.intent === "string") {
        setSelectedIntent(params.intent as IntentId);
        setStage("capture"); // reset UI when intent changes
      }
    }, [params?.intent]);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleChipSelect = (id: IntentId) => {
      setSelectedIntent(id);
      setStage("capture");
      setMealItems([]);
      setNutritionSummary(null);
      setMealResult(null);
    };

    // Bottom input bar: detect intent and route
    const handleBottomSend = () => {
      setMicStatus(null); // 🔥 CLEAR OLD MESSAGE

      const text = bottomInput.trim();
      if (!text) return;

      const intent = detectIntent(text);

      if (intent === "analyze_meal") {
        const items = extractMealItems(text);

        if (items.length === 0) {
          setMicStatus("Couldn't understand meal. Try again.");
          return;
        }

        setSelectedIntent("analyze_meal"); // ✅ ADD THIS
        runMealAnalysis(items, false);
        setBottomInput("");
      } else if (intent === "improve_meal") {
        const items = extractMealItems(text);

        if (items.length > 0) {
          setSelectedIntent("improve_meal");
          runMealAnalysis(items, true); // ✅ SAME FLOW
        } else {
          setSelectedIntent("improve_meal");
          setStage("capture");
          setMicStatus("Enter a meal to improve"); // 🔥 ADD THIS
        }
        setBottomInput("");
      } else if (intent) {
        setSelectedIntent(intent);
        setBottomInput("");
      }
    }; // ✅ 👈 CLOSE FUNCTION HERE

    // Capture stage: user typed in the capture input area
    const handleCaptureSubmit = (text: string) => {
      const items = extractMealItems(text);

      if (items.length === 0) {
        setMicStatus("Couldn't understand meal. Try again.");
        return;
      }

      const intent = selectedIntent ?? "analyze_meal";
      setSelectedIntent(intent);

      setBottomInput(""); // ✅ ADD HERE

      runMealAnalysis(items, intent === "improve_meal");
    };

    const runMealAnalysis = (items: MealItem[], withImprove = false) => {
      const nutrition = estimateNutrition(items);
      const result = computeResult(nutrition);

      if (withImprove) {
        result.improvements = generateImprovements(items, nutrition);
      }

      setMealItems(items);
      setNutritionSummary(nutrition);
      setMealResult(result);
      setStage("result");

      // 👇 add this
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    };


    // Reset everything
    const handleReset = () => {
      const text = bottomInput.trim();
      const nextIntent = selectedIntent ?? "analyze_meal";

      if (text.length > 0) {
        const items = extractMealItems(text);

        if (items.length === 0) {
          setMicStatus("Couldn't understand meal. Try again.");
          return;
        }

        setSelectedIntent(nextIntent);
        runMealAnalysis(items, nextIntent === "improve_meal"); // ✅ direct flow
        setBottomInput("");
        return;
      }

      setStage("capture");
      setSelectedIntent(nextIntent);
      setMealItems([]);
      setNutritionSummary(null);
      setMealResult(null);
      setBottomInput("");
    };

    // Mic: V1 placeholder — transcription comes from parent voice system in future
    const handleMicPress = () => {
      setMicStatus("Voice input not yet connected");
      setTimeout(() => setMicStatus(null), 2000);
    };

    // ── Bottom bar contextual placeholder ────────────────────────────────────

    const bottomPlaceholder =
      selectedIntent === "analyze_meal"
        ? "Tell me what you ate..."
        : selectedIntent === "improve_meal"
          ? "What should we improve?"
          : "Ask anything..."


    // ── Render ────────────────────────────────────────────────────────────────

    log("debug", "Render AnalyzeMeal", {
      stage,
      selectedIntent,
    });

    return (
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 22,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: C.accent,
              shadowOpacity: 0.1,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            <Text style={{ fontSize: 26, fontWeight: "500" }}>
              <Text style={{ color: C.text }}>Better</Text>
              <Text style={{ color: C.accent }}>Me</Text>
              <Text style={{ color: C.muted, opacity: 0.5 }}>{" · Daily"}</Text>
            </Text>
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 3, opacity: 0.75 }}>
              Better meals. Better habits. Better you.
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: C.bg }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            {/* Scrollable content */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 120,
              }}
            >
              <ChipBar selected={selectedIntent} onSelect={handleChipSelect} />

              {/* Stage: capture */}

              {stage === "capture" && selectedIntent === "analyze_meal" && (
                <CaptureStage onSubmit={handleCaptureSubmit} />
              )}

              {stage === "capture" && selectedIntent === "improve_meal" && (
                <ImproveMealBody
                  items={mealItems}
                  onChange={setMealItems}
                  onConfirm={() => runMealAnalysis(mealItems, true)}
                />
              )}

              {/* Stage: capture, non-meal intent */}
              {stage === "capture" &&
                selectedIntent !== null &&
                selectedIntent !== "analyze_meal" &&
                selectedIntent !== "improve_meal" && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: C.muted, fontSize: 15, textAlign: "center", marginTop: 40 }}>
                      <Text style={{ color: C.accent }}>
                        {labelMap[selectedIntent as keyof typeof labelMap] || "What now"}
                      </Text>
                      {" "}coming soon
                    </Text>
                  </View>
                )}

              {/* Stage: confirm */}
              {/* Stage: result */}
              {stage === "result" && nutritionSummary && mealResult && (
                <ResultStage
                  nutrition={nutritionSummary}
                  result={mealResult}
                  onReset={handleReset}
                />
              )}
            </ScrollView>

            {/* Mic status toast */}
            {micStatus && (
              <View style={{ alignItems: "center", paddingVertical: 4 }}>
                <Text style={{ color: C.muted, fontSize: 13 }}>{micStatus}</Text>
              </View>
            )}

            {/* Fixed input bar */}
            <View
              style={{
                flexDirection: "row",
                backgroundColor: C.surface,
                borderRadius: 16,
                padding: 8,
                marginHorizontal: 12,
                marginBottom: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: C.border,
              }}
            >

              {/* 🏠 HOME BUTTON — ADD HERE */}
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

              {/* INPUT */}
              <TextInput
                value={bottomInput}
                onChangeText={(text) => {
                  setBottomInput(text);
                  if (micStatus) setMicStatus(null);
                }}
                placeholder={bottomPlaceholder}
                placeholderTextColor={C.muted}
                style={{
                  flex: 1,
                  color: C.text,
                  paddingVertical: 6,
                  paddingHorizontal: 4,
                  fontSize: 14
                }}
                onSubmitEditing={handleBottomSend}
                returnKeyType="send"
              />

              {/* Mic button */}
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

              {/* Send button (ONLY when not in result stage) */}
              {stage !== "result" && (
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
              )}

              {/* Reset button (ONLY in result stage) */}
              {stage === "result" && (
                <TouchableOpacity
                  onPress={handleReset}
                  style={{
                    backgroundColor: C.accent,   // 🔥 make primary
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "600", fontSize: 13 }}>
                    New Meal
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }