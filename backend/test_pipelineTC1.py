import asyncio, sys
sys.path.insert(0, 'backend')
import main as M

CASES = [
    "Prediabetic",
    "Sugar crash",
    "Cholesterol increased",
    "Lipid variability"
]

async def run():
    print(f"{'Query':<25} {'domain':<12} {'need':<14} {'LLM?'}")
    print("-"*65)
    for q in CASES:
        res = await M.build_response(q, lite=False)
        intent = res.get("intent", {})
        text = res.get("text", "")

        # crude LLM detection: mock/fallback/clarify vs real formatted output
        llm_hit = not any(x in text.lower() for x in [
            "clarify", "empty query", "fallback"
        ])

        print(f"{q:<25} {intent.get('domain'):<12} {intent.get('need'):<14} {llm_hit}")

asyncio.run(run())
EOF