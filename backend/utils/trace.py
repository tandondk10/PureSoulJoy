import time
import random


def create_trace_id() -> str:
    return f"TRACE_{int(time.time() * 1000)}_{random.randint(100, 999)}"
