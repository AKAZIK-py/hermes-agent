"""Reference-delegate child: empty response degrades immediately.

A reference advisor's child is advisory and pinned to a specific reference
model. An empty reference means "no useful advice", not "the user got no
answer" — so the child must NOT retry (re-billing its input for no benefit)
and must NOT walk the fallback chain (which would silently swap the pinned
reference model and corrupt the reference signal's identity).

The flag is set in ``_SharedDelegateNode._run_child`` (see
test_moa_loop_mode.test_reference_delegate_child_marks_fail_open_empty_policy)
and consumed by the empty-retry gate in ``run_conversation`` — this file
exercises the consumer side end-to-end against a real ``AIAgent``.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from run_agent import AIAgent


def _empty_response():
    message = SimpleNamespace(content="", tool_calls=None)
    choice = SimpleNamespace(message=message, finish_reason="stop")
    return SimpleNamespace(choices=[choice], model="test/model", usage=None)


def _make_agent():
    with (
        patch("run_agent.get_tool_definitions", return_value=[]),
        patch("run_agent.check_toolset_requirements", return_value={}),
        patch("run_agent.OpenAI"),
    ):
        agent = AIAgent(
            api_key="test-key",
            base_url="https://openrouter.ai/api/v1/",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
    agent._cached_system_prompt = "You are helpful."
    agent._use_prompt_caching = False
    agent.compression_enabled = False
    agent.save_trajectories = False
    agent.valid_tool_names = set()
    agent.client = MagicMock()
    return agent


def test_reference_child_empty_degrades_without_retry_or_fallback():
    agent = _make_agent()
    agent._reference_delegate_child = True
    # A truthy fallback chain that WOULD trigger if the gate regressed.
    agent._fallback_chain = ["some-other-model"]
    # Three empty responses: enough for a full 3-retry walk if the flag is
    # ignored, and a StopIteration-free single call if it is honoured.
    agent.client.chat.completions.create.side_effect = [
        _empty_response(),
        _empty_response(),
        _empty_response(),
    ]

    # Tripwire: the empty-retry backoff sleeps between attempts. A reference
    # child must never reach it, so any sleep here means the gate regressed —
    # fail fast instead of spinning through jittered backoff for 5-60s.
    def _no_sleep(*_args, **_kwargs):
        raise AssertionError("empty retry backoff must not run for a reference child")

    with (
        patch("agent.conversation_loop.time.sleep", _no_sleep),
        patch.object(agent, "_try_activate_fallback", return_value=False) as fallback,
        patch.object(agent, "_persist_session"),
        patch.object(agent, "_save_trajectory"),
        patch.object(agent, "_cleanup_task_resources"),
    ):
        result = agent.run_conversation("advise me on this claim")

    assert result["api_calls"] == 1, (
        f"expected 1 call (no empty retry), got {result['api_calls']}"
    )
    assert fallback.call_count == 0, "fallback chain must not be walked"
    # The "(empty)" sentinel is wrapped into a user-facing notice downstream;
    # the precise signal that we degraded (no retry, no fallback) is the exit
    # reason reaching the terminal empty path on the FIRST attempt.
    assert result["turn_exit_reason"] == "empty_response_exhausted"
