export type GlucoseState =
    | "none"
    | "prediabetic"
    | "prediabetic_or_diagnosed"
    | "diagnosed";

export type UserProfile = {
    user_id: string;
    conditions: {
        glucose: {
            state: GlucoseState;
            phenotype?: string;
            insulin_sensitivity?: string;
            insulin_production?: string;
        };
        bp: {
            state: "none" | "elevated" | "high" | "elevated_or_high";
        };
        cholesterol: {
            state: "none" | "elevated" | "high" | "elevated_or_high";
        };
    };
};