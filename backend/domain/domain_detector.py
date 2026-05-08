from typing import Optional

def detect_condition_domain(query: str) -> Optional[str]:
    
    q = query.lower()

    if any(k in q for k in ["bg", "glucose", "sugar", "a1c"]):
        return "glucose"

    if any(k in q for k in ["bp", "blood pressure"]):
        return "bp"

    if any(k in q for k in ["ldl", "cholesterol", "triglycerides"]):
        return "cholesterol"

    return None