from domain.test_users import TEST_USERS
from domain.user_state_mapper import map_user_to_engine_state
from domain.domain_detector import detect_condition_domain
from domain.context_detector import detect_context
from domain.lever_selector import select_top_levers
from domain.action_mapper import map_actions


query = "why my BG goes up after a carb meal?"

for key, user in TEST_USERS.items():
    user_state = map_user_to_engine_state(user)

    domain = detect_condition_domain(query) or "lifestyle"
    context = detect_context(query)
    levers = select_top_levers(domain, context, user_state["conditions"])

    # 🔥 THIS IS WHAT YOU ARE MISSING
    
    actions = map_actions(domain, context, levers, user_state)

    print("\n---", key, "---")
    print("domain:", domain)
    print("context:", context)
    print("levers:", levers)
    print("actions:", actions)