import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { UIAction, ActionCategory } from "../../types/actions";

export type ActionCardProps = {
  action: UIAction;
  showRationale?: boolean;
};

export function ActionCard({ action, showRationale = false }: ActionCardProps) {
  return (
    <View style={styles.card} testID={`action-card-${action.id}`}>
      <View style={styles.headerRow}>
        <Text style={styles.category}>{labelForCategory(action.category)}</Text>
        {action.durationMinutes ? (
          <Text style={styles.duration}>{action.durationMinutes} min</Text>
        ) : null}
      </View>

      <Text style={styles.title}>{action.title}</Text>

      {action.title !== action.instruction ? (
        <Text style={styles.instruction}>{action.instruction}</Text>
      ) : null}

      {action.timing ? <Text style={styles.timing}>{action.timing}</Text> : null}

      {showRationale && action.rationale ? (
        <Text style={styles.rationale}>{action.rationale}</Text>
      ) : null}
    </View>
  );
}

function labelForCategory(category: ActionCategory): string {
  switch (category) {
    case "movement":      return "Movement";
    case "hydration":     return "Hydration";
    case "food_sequence": return "Food order";
    case "next_meal":     return "Next meal";
    case "recovery":      return "Recovery";
    case "education":     return "Learn";
    case "clarification": return "Question";
    case "safety":        return "Safety";
    default:              return "Action";
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    backgroundColor: "#121821",
    borderWidth: 1,
    borderColor: "#2D3748",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  category: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  duration: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 2,
  },
  instruction: {
    fontSize: 14,
    lineHeight: 20,
    color: "#D1D5DB",
  },
  timing: {
    fontSize: 12,
    marginTop: 6,
    color: "#9CA3AF",
  },
  rationale: {
    fontSize: 12,
    marginTop: 6,
    color: "#9CA3AF",
    fontStyle: "italic",
  },
});
