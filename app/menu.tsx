import { Colors } from "@/constants/theme";
import { useRouter } from "expo-router";
import { Text, TouchableOpacity, View } from "react-native";

export default function MenuScreen() {
    const router = useRouter();
    const C = Colors["dark"]; // 🔥 force dark
    console.log("MENU SCREEN LOADED");

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: "#0B0F14", // 🔥 HARD FIX (not C.bg)
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <Text style={{ color: C.text, fontSize: 24, marginBottom: 30 }}>
                What do you want to do?
            </Text>

            <TouchableOpacity onPress={() => router.push("/(tabs)")}>
                <Text style={{ color: "#FFD06A", fontSize: 18 }}>
                    Query
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={() =>
                    router.push({
                        pathname: "/meal?intent=analyze_meal",
                        params: { intent: "analyze_meal" },
                    })
                }
            >
                <Text style={{ color: "#FFD06A", fontSize: 18 }}>
                    Analyze Meal
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={() =>
                    router.push({
                        pathname: "/meal?intent=analyze_meal",
                        params: { intent: "/meal?intent=improve_meal" },
                    })
                }
            >
                <Text style={{ color: "#FFD06A", fontSize: 18 }}>
                    Improve Meal
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={() => router.push("/")} // 👈 go to home screen
                style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: C.surfaceAlt,
                    marginRight: 6,
                }}
            >
                <Text style={{ color: C.text }}>Menu</Text>
            </TouchableOpacity>

        </View>
    );
}