import requests

URL = "http://localhost:8000/query"

TEST_CASES = [
    # Query, Expected Domain, Expected Need
    ("My sugar is high", "glucose", "intervention"),
    ("My sugar is high after lunch", "glucose", "intervention"),
    ("My BG shot up", "glucose", "intervention"),
    ("Glucose spike after breakfast", "glucose", "intervention"),
    ("What causes glucose spikes", "glucose", "education"),
    ("Prediabetic", "glucose", "education"),
    ("Hyperglycemia after dinner", "glucose", "intervention"),
    ("Sugar crash", "glucose", "intervention"),
    ("Hypo after meal", "glucose", "intervention"),
    ("BP fluctuating", "bp", "intervention"),
    ("Blood pressure is high", "bp", "intervention"),
    ("Systolic is elevated", "bp", "intervention"),
    ("BP dropped", "bp", "intervention"),
    ("Cholesterol increased", "cholesterol", "intervention"),
    ("LDL is high", "cholesterol", "intervention"),
    ("Low HDL", "cholesterol", "intervention"),
    ("Lipid variability", "cholesterol", "intervention"),
    ("How to reduce sugar levels", "glucose", "guidance"),
    ("Why is BP high", "bp", "education"),
    ("Suggest foods for cholesterol", "cholesterol", "guidance"),
    ("High protein lunch", "lifestyle", "education"),
]

print(f"{'Query':<40} {'Domain':<15} {'Need':<15} {'Result':<10}")
print("-" * 90)

all_pass = True

for q, exp_domain, exp_need in TEST_CASES:
    try:
        res = requests.post(URL, json={"query": q})

        # 🔥 CHECK RESPONSE TYPE SAFELY
        try:
            data = res.json()
        except Exception:
            print(f"{q:<40} ERROR: Non-JSON response → {res.text[:80]}")
            all_pass = False
            continue

        # 🔥 HANDLE STRING RESPONSE (current backend issue)
        if isinstance(data, str):
            print(f"{q:<40} ERROR: String response → {data[:80]}")
            all_pass = False
            continue

        # 🔥 SAFE EXTRACTION
        intent = data.get("intent", {})
        domain = intent.get("domain")
        need = intent.get("need")

        ok = domain == exp_domain and need == exp_need

        print(f"{q[:38]:<40} {str(domain):<15} {str(need):<15} {'✓' if ok else '✗'}")

        if not ok:
            print(f"   Expected → {exp_domain} | {exp_need}")
            print(f"   Actual   → {domain} | {need}")
            all_pass = False

    except Exception as e:
        print(f"{q:<40} ERROR: {e}")
        all_pass = False

print("\n" + ("ALL PASS ✓" if all_pass else "FAILURES — FIX BEFORE PROCEED"))
