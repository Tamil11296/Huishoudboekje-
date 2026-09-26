import os
from pathlib import Path
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent / ".env")
_KEY = os.environ.get("EMERGENT_LLM_KEY")


async def ask_claude(session_id: str, system_message: str, prompt: str,
                     model: str = "claude-sonnet-4-6") -> str:
    """Non-streaming single-turn call to Claude via the Emergent universal key."""
    chat = LlmChat(api_key=_KEY, session_id=session_id,
                   system_message=system_message).with_model("anthropic", model)
    resp = await chat.send_message(UserMessage(text=prompt))
    return resp if isinstance(resp, str) else str(resp)
