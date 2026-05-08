# backend/services/food_db_updater.py

import csv
import os

CSV_PATH = "backend/data/food_items.csv"

FIELDNAMES = [
    "name",
    "carbs_g",
    "protein_g",
    "fat_g",
    "sat_fat_g",
    "fiber_g",
    "calories",
    "source"
]


def save_food_to_csv(food_name: str, nutrients: dict):
    if not nutrients:
        return

    # normalize key
    food_name = food_name.lower().strip()

    # 🔍 Check if already exists
    if os.path.exists(CSV_PATH):
        with open(CSV_PATH, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["name"].strip().lower() == food_name:
                    print(f"[CSV_SKIP_EXISTS] {food_name}")
                    return

    # ➕ Append new row
    with open(CSV_PATH, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)

        # write header if file empty
        if os.stat(CSV_PATH).st_size == 0:
            writer.writeheader()

        writer.writerow({
            "name": food_name,
            "carbs_g": nutrients.get("carbs_g", 0),
            "protein_g": nutrients.get("protein_g", 0),
            "fat_g": nutrients.get("fat_g", 0),
            "sat_fat_g": nutrients.get("sat_fat_g", 0),
            "fiber_g": nutrients.get("fiber_g", 0),
            "calories": nutrients.get("calories", 0),
            "source": "usda"
        })

    print(f"[CSV_ADDED] {food_name}")