from pydantic import BaseModel

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolRegistry, ToolResult


class EmptyArgs(BaseModel):
    pass


class NamedTool(BaseTool):
    description = "test tool"
    input_model = EmptyArgs

    def __init__(self, name: str) -> None:
        self.name = name

    async def execute(
        self,
        arguments: EmptyArgs,
        context: ToolExecutionContext,
    ) -> ToolResult:
        del arguments, context
        return ToolResult(output="ok")


registry = ToolRegistry()
registry.register(NamedTool("skill"))
registry.register(NamedTool("bash"))
registry.register(NamedTool("inspect_current_beauty_frame"))
registry.retain({"inspect_current_beauty_frame"})

assert [tool.name for tool in registry.list_tools()] == [
    "inspect_current_beauty_frame"
]
