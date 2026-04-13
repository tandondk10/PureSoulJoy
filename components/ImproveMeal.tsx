import React, { useState } from "react";
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
import { log, withTrace } from "../utils/instrumentation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "capture" | "confirm" | "result";
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

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceAlt: "#071427",
  text: "#FFFFFF",
  muted: "#9CA3AF",
  accent: "#FFD06A",
  accentDim: "rgba(255,208,106,0.12)",
  border: "rgba(255,255,255,0.08)",
  borderAccent: "rgba(255,208,106,0.20)",
  error: "#EF4444",
  green: "#4ADE80",
  greenDim: "rgba(74,222,128,0.12)",
  errorDim: "rgba(239,68,68,0.12)",
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
  const parts = text
    .split(/,|\band\b|\n/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.map((part, i) => {
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

function computeImprovementSuggestions(
  nutrition: NutritionSummary,
): string[] {
  const netCarbs = Math.max(0, nutrition.carbs - nutrition.fiber_total);
  const suggestions: string[] = [];

  if (netCarbs > 150) {
    suggestions.push("Consider splitting this meal or reducing carb load significantly");
  } else if (netCarbs > 80) {
    suggestions.push("Reduce portion of high-carb items (rice, bread, pasta)");
  }

  if (nutrition.fiber_total < 3) {
    suggestions.push("Add fiber (vegetables, salad, legumes)");
  }

  if (nutrition.fiber_soluble < 2) {
    suggestions.push("Add soluble fiber (oats, lentils, beans)");
  }

  if (nutrition.protein < 15) {
    suggestions.push("Add protein (eggs, chicken, paneer, tofu)");
  }

  if (nutrition.fats > 30) {
    suggestions.push("Reduce heavy fats (fried items, butter, oil)");
  }

  if (suggestions.length === 0) {
    suggestions.push("Meal looks balanced — small tweaks can further improve it");
  }

  return suggestions;
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
        What can we improve?
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
          Improve Meal
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
        Edit items, then improve
      </Text>

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
          Improve This Meal
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

function SuggestionsSection({ suggestions }: { suggestions: string[] }) {
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

function NutritionSummarySection({ nutrition }: { nutrition: NutritionSummary }) {
  const netCarbs = Math.max(0, nutrition.carbs - nutrition.fiber_total);

  return (
    <ResultCard title="Nutrition Summary">
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ color: C.muted, fontSize: 14 }}>Net carbs</Text>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: "500" }}>{Math.round(netCarbs)}g</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ color: C.muted, fontSize: 14 }}>Fiber (total)</Text>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: "500" }}>{nutrition.fiber_total}g</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: C.muted, fontSize: 14 }}>Soluble fiber</Text>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: "500" }}>{nutrition.fiber_soluble}g</Text>
      </View>
    </ResultCard>
  );
}

function ImproveResultStage({
  nutrition,
  suggestions,
  onReset,
}: {
  nutrition: NutritionSummary;
  suggestions: string[];
  onReset: () => void;
}) {
  return (
    <View>
      <SuggestionsSection suggestions={suggestions} />
      <NutritionSummarySection nutrition={nutrition} />

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
        <Text style={{ color: C.muted, fontSize: 14 }}>Improve another meal</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── ImproveMealBody: embeddable content (no outer chrome) ────────────────────

export function ImproveMealBody() {
  const [stage, setStage] = useState<Stage>("capture");
  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [nutritionSummary, setNutritionSummary] = useState<NutritionSummary | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  const handleCaptureSubmit = (text: string) => {
    setMealItems(extractMealItems(text));
    setStage("confirm");
  };

  const handleImprove = withTrace("ImproveMealBody.handleImprove", () => {
    log("debug", "ImproveMealBody.handleImprove", { itemCount: mealItems.length });
    const nutrition = estimateNutrition(mealItems);
    setSuggestions(computeImprovementSuggestions(nutrition));
    setNutritionSummary(nutrition);
    setStage("result");
  });

  const handleReset = () => {
    setStage("capture");
    setMealItems([]);
    setNutritionSummary(null);
    setSuggestions(null);
  };

  if (stage === "capture") {
    return <CaptureStage onSubmit={handleCaptureSubmit} />;
  }

  if (stage === "confirm") {
    return (
      <ConfirmStage
        items={mealItems}
        onChange={setMealItems}
        onConfirm={handleImprove}
      />
    );
  }

  if (stage === "result" && nutritionSummary && suggestions) {
    return (
      <ImproveResultStage
        nutrition={nutritionSummary}
        suggestions={suggestions}
        onReset={handleReset}
      />
    );
  }

  return null;
}

// ─── Main Component (standalone screen) ──────────────────────────────────────

export default function ImproveMeal() {
  const [selectedIntent, setSelectedIntent] = useState<IntentId>("improve_meal");
  const [bottomInput, setBottomInput] = useState("");
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("capture");
  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [nutritionSummary, setNutritionSummary] = useState<NutritionSummary | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  const handleChipSelect = (id: IntentId) => {
    setSelectedIntent(id);
    if (id === "improve_meal") setStage("capture");
  };

  const handleBottomSend = () => {
    const text = bottomInput.trim();
    if (!text) return;
    if (selectedIntent === "improve_meal") {
      setMealItems(extractMealItems(text));
      setStage("confirm");
      setBottomInput("");
    }
  };

  const handleCaptureSubmit = (text: string) => {
    setMealItems(extractMealItems(text));
    setStage("confirm");
  };

  const handleImprove = () => {
    const nutrition = estimateNutrition(mealItems);
    setSuggestions(computeImprovementSuggestions(nutrition));
    setNutritionSummary(nutrition);
    setStage("result");
  };

  const handleReset = () => {
    const text = bottomInput.trim();
    if (text.length > 0) {
      setMealItems(extractMealItems(text));
      setStage("confirm");
      setBottomInput("");
      return;
    }
    setStage("capture");
    setMealItems([]);
    setNutritionSummary(null);
    setSuggestions(null);
    setBottomInput("");
  };

  const handleMicPress = () => {
    setMicStatus("Voice input not yet connected");
    setTimeout(() => setMicStatus(null), 2000);
  };

  const bottomPlaceholder =
    stage === "result"
      ? "Type meal... press New Meal"
      : "Or type meal here and send...";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
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
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
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

            {selectedIntent === "improve_meal" && stage === "capture" && (
              <CaptureStage onSubmit={handleCaptureSubmit} />
            )}

            {selectedIntent === "improve_meal" && stage === "confirm" && (
              <ConfirmStage
                items={mealItems}
                onChange={setMealItems}
                onConfirm={handleImprove}
              />
            )}

            {selectedIntent === "improve_meal" && stage === "result" && nutritionSummary && suggestions && (
              <ImproveResultStage
                nutrition={nutritionSummary}
                suggestions={suggestions}
                onReset={handleReset}
              />
            )}

            {selectedIntent !== "improve_meal" && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: C.muted, fontSize: 15, textAlign: "center", marginTop: 40 }}>
                  <Text style={{ color: C.accent }}>
                    {selectedIntent === "analyze_meal"
                      ? "Analyze"
                      : selectedIntent === "build_meal"
                        ? "Build"
                        : "What now"}
                  </Text>
                  {" "}coming soon
                </Text>
              </View>
            )}
          </ScrollView>

          {micStatus && (
            <View style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ color: C.muted, fontSize: 13 }}>{micStatus}</Text>
            </View>
          )}

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
            <TextInput
              value={bottomInput}
              onChangeText={setBottomInput}
              placeholder={bottomPlaceholder}
              placeholderTextColor={C.muted}
              style={{ flex: 1, color: C.text, paddingVertical: 6, paddingHorizontal: 4, fontSize: 14 }}
              onSubmitEditing={handleBottomSend}
              returnKeyType="send"
            />

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
                <Text style={{ color: "#000", fontWeight: "600", fontSize: 13 }}>Send</Text>
              </TouchableOpacity>
            )}

            {stage === "result" && (
              <TouchableOpacity
                onPress={handleReset}
                style={{
                  backgroundColor: C.accent,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: "#000", fontWeight: "600", fontSize: 13 }}>New Meal</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
