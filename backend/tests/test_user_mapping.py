import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from domain.test_users import TEST_USERS
from domain.user_state_mapper import map_user_to_engine_state

for key, user in TEST_USERS.items():
    print(key, map_user_to_engine_state(user))