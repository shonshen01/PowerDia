from pgadmin.llm.utils import get_default_provider, is_llm_enabled, is_llm_enabled_system
import config
print(f"config.LLM_ENABLED: {getattr(config, 'LLM_ENABLED', None)}")
print(f"config.DEFAULT_LLM_PROVIDER: {getattr(config, 'DEFAULT_LLM_PROVIDER', None)}")
try:
    print(f"get_default_provider: {get_default_provider()}")
    print(f"is_llm_enabled: {is_llm_enabled()}")
    print(f"is_llm_enabled_system: {is_llm_enabled_system()}")
except Exception as e:
    print(f"Error: {e}")
