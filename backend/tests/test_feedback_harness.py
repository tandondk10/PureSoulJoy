import requests
import json

import time
import random
from utils.trace import create_trace_id

BASE_URL = "http://localhost:8000"  # change to Railway URL later


def create_trace_id():
    return f"TRACE_{int(time.time() * 1000)}_{random.randint(100,999)}"


def run_test(query, feedback_type="helpful"):
    print("\n=== TEST CASE ===")
    print("Query:", query)

    # 1. Generate trace_id ONCE
    trace_id = create_trace_id()

    # 2. Call /query
    res = requests.post(
        f"{BASE_URL}/query",
        json={"query": query},
        headers={"x-trace-id": trace_id},
    )

    if res.status_code != 200:
        print("❌ Query failed:", res.text)
        return

    data = res.json()

    # 3. Extract trace_id from response (optional verification)
    if "_trace" in data:
        try:
            trace_obj = data["_trace"]
            if isinstance(trace_obj, str):
                trace_obj = json.loads(trace_obj)

            trace_id = trace_obj.get("trace_id", trace_id)
        except Exception as e:
            print("⚠️ trace parse error:", e)

    # 4. Extract action (handle both formats safely)
    action = None

    if "structured" in data and data["structured"].get("top_actions"):
        action = data["structured"]["top_actions"][0]
    elif "screen" in data and data["screen"].get("top_actions"):
        action = data["screen"]["top_actions"][0]

    print("trace_id:", trace_id)
    print("action:", action)

    if not trace_id or not action:
        print("⚠️ Skipping feedback (missing trace/action)")
        return

    # 5. Send feedback
    res2 = requests.post(
        f"{BASE_URL}/feedback",
        json={
            "trace_id": trace_id,
            "action": action,
            "feedback": feedback_type,
        },
    )

    print("Feedback response:", res2.json())
    print("✅ Completed test")


if __name__ == "__main__":
    # Run multiple scenarios

    run_test("rice 110g, dal 110g", "helpful")
#    run_test("when, can, i, start, a, walk, after, eating", "helpful")
#    run_test(
#        "when, can, i, start, a, walk, after, eating, a, heavy, carb, meal", "helpful"
#    )
#    run_test(
#        "when, can, i, start, a, walk, after, eating, a, heavy, carb, meal",
#        "not_helpful",
#   )  # edge case (may skip)
