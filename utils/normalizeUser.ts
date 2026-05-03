export const getNormalizedUser = (user: any) => {
    return {
        user_id: user?.user_id ?? "anonymous",

        conditions: {
            glucose: {
                state: user?.conditions?.glucose?.state ?? "none",
                phenotype: user?.conditions?.glucose?.phenotype ?? null,
                insulin_sensitivity: user?.conditions?.glucose?.insulin_sensitivity ?? null,
                insulin_production: user?.conditions?.glucose?.insulin_production ?? null,
            },

            bp: {
                state: user?.conditions?.bp?.state ?? "none",
            },

            cholesterol: {
                state: user?.conditions?.cholesterol?.state ?? "none",
            }
        }
    };
};