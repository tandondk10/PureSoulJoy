import AppHeader from "@/components/AppHeader";
import { C } from "@/constants/colors";
import { useUser } from "@/context/UserContext";
import { profiles } from "@/data/profiles";
import { saveUser } from "@/utils/storage";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    StyleSheet, // ✅ make sure this is imported
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";


export default function LoginScreen() {
    const router = useRouter();
    const { setUser } = useUser();

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const handleLogin = async () => {
        if (!username || !password) {
            setError("Please enter username and password");
            return;
        }

        const selectedUser = Object.values(profiles).find(
            (p: any) =>
                p.loginId.toLowerCase() === username.trim().toLowerCase() &&
                p.password.toLowerCase() === password.trim().toLowerCase()
        );

        if (!selectedUser) {
            setError("Invalid username or password");
            return;
        }

        setError("");
        setUser(selectedUser);
        await saveUser(selectedUser.id);

        router.replace("/");
    };

    const handleLogout = async () => {
        await saveUser(""); // clear storage
        setUser(null);
        setTimeout(() => {
            router.replace("/login");
        }, 0);
    };

    const handleDemo = async () => {
        const selectedUser = profiles.deepak;

        setUser(selectedUser);
        await saveUser(selectedUser.id);

        router.replace("/");
    };
    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
            <View style={styles.container}>
                <AppHeader showProfile={false} />

                <View style={styles.form}>
                    <TextInput
                        placeholder="Username"
                        placeholderTextColor={C.muted}
                        value={username}
                        onChangeText={setUsername}
                        style={styles.input}
                    />

                    <TextInput
                        placeholder="Password"
                        placeholderTextColor={C.muted}
                        secureTextEntry
                        value={password}
                        onChangeText={setPassword}
                        style={styles.input}
                    />

                    {error ? <Text style={styles.error}>{error}</Text> : null}

                    <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
                        <Text style={styles.loginText}>Log In →</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.demoBtn} onPress={handleDemo}>
                        <Text style={[styles.demoText, { color: C.accent }]}>
                            Continue as Demo
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={async () => {
                            console.log("RESET CLICKED");

                            await saveUser("");

                            const check = await loadUser();
                            console.log("AFTER RESET:", check);

                            setUser(null);

                            // ❌ no navigation needed here
                        }}
                    >
                        <Text style={{ color: C.muted, marginTop: 20 }}>
                            Reset Login (Dev)
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: C.bg,
        padding: 16,
    },
    form: {
        marginTop: 30,
    },
    input: {
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)",
        borderRadius: 12,
        padding: 14,
        color: C.text,
        marginBottom: 12,
        backgroundColor: C.surface,
    },
    loginBtn: {
        backgroundColor: C.accent,
        padding: 14,
        borderRadius: 12,
        alignItems: "center",
        marginTop: 10,
    },
    loginText: {
        color: "#000",
        fontWeight: "600",
        fontSize: 16,
    },
    demoBtn: {
        marginTop: 20,
        alignItems: "center",
    },
    demoText: {
        color: C.muted,
        fontSize: 14,
    },
    error: {
        color: "red",
        marginBottom: 10,
    },
});