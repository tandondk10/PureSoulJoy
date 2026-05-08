TEST_USERS = {
    "normal_wellness": {
        "name": "Normal Wellness",
        "conditions": {
            "glucose": {"state": "none", "phenotype": None},
            "bp": {"state": "none"},
            "cholesterol": {"state": "none"},
        }
    },

    "t2_diabetic": {
        "name": "T2 Diabetic",
        "conditions": {
            "glucose": {
                "state": "diagnosed",
                "phenotype": "t2_reduced_sensitivity_reduced_production",
                "insulin_sensitivity": "reduced_high_severity",
                "insulin_production": "reduced_high_severity",
            },
            "bp": {"state": "none"},
            "cholesterol": {"state": "none"},
        }
    },

    "prediabetic_slippery_slope": {
        "name": "Prediabetic Slippery Slope",
        "conditions": {
            "glucose": {
                "state": "prediabetic",
                "phenotype": "reduced_sensitivity_high_production",
                "insulin_sensitivity": "reduced_like_t2",
                "insulin_production": "high",
            },
            "bp": {"state": "none"},
            "cholesterol": {"state": "none"},
        }
    },

    "metabolic_syndrome": {
        "name": "Metabolic Syndrome",
        "conditions": {
            "glucose": {
                "state": "prediabetic_or_diagnosed",
                "phenotype": "reduced_sensitivity_moderately_reduced_production",
                "insulin_sensitivity": "reduced_like_t2",
                "insulin_production": "reduced_moderate",
            },
            "bp": {"state": "elevated_or_high"},
            "cholesterol": {"state": "elevated_or_high"},
        }
    },

    "slow_starter": {
        "name": "Slow Starter",
        "conditions": {
            "glucose": {
                "state": "prediabetic",
                "phenotype": "high_sensitivity_reduced_production",
                "insulin_sensitivity": "high",
                "insulin_production": "reduced_moderate",
            },
            "bp": {"state": "none"},
            "cholesterol": {"state": "none"},
        }
    },

    "t2_without_metabolic_syndrome": {
        "name": "T2 Diabetes without Metabolic Syndrome",
        "conditions": {
            "glucose": {
                "state": "diagnosed",
                "phenotype": "high_sensitivity_t2_level_reduced_production",
                "insulin_sensitivity": "high",
                "insulin_production": "reduced_high_severity",
            },
            "bp": {"state": "none"},
            "cholesterol": {"state": "none"},
        }
    },
}