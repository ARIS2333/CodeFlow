"""Deterministic, bounded execution tracing for single-function Python tasks.

The visible flowchart and this tracer share the same Tree-sitter analysis.  The
tracer rewrites Python's standard-library AST only to add state events; it never
asks a model to simulate execution.  Unsupported source shapes fail closed so
the frontend can use its existing model fallback.
"""

from __future__ import annotations

import ast
import json
import os
import resource
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from code_analysis import analyze_code


MAX_TRACE_STEPS = 120
TRACE_PREFIX = "__CFTRACE__"
RESULT_PREFIX = "__CFRESULT__"
RUN_TIMEOUT_SECONDS = float(os.getenv("PYTHON_TRACE_RUN_TIMEOUT_SECONDS", "3"))


class PythonTraceError(RuntimeError):
    """The source could not be traced without guessing."""


_RUNTIME = r'''
import json as __cf_json
import reprlib as __cf_reprlib
import sys as __cf_sys

__cf_steps = 0
__cf_repr = __cf_reprlib.Repr()
__cf_repr.maxlevel = 4
__cf_repr.maxlist = 20
__cf_repr.maxtuple = 20
__cf_repr.maxset = 20
__cf_repr.maxfrozenset = 20
__cf_repr.maxdict = 20
__cf_repr.maxstring = 120
__cf_repr.maxother = 120

def __cf_value(value):
    try:
        return __cf_repr.repr(value)
    except BaseException:
        return "<unavailable>"

def __cf_snapshot(namespace):
    result = {}
    for name, value in namespace.items():
        if name.startswith("__cf_") or name == "__builtins__":
            continue
        if callable(value) or isinstance(value, type(__cf_sys)):
            continue
        if len(result) >= 8:
            break
        result[str(name)] = __cf_value(value)
    return result

def __cf_emit(node_id, namespace):
    global __cf_steps
    if __cf_steps >= 120:
        return
    __cf_steps += 1
    event = {"nodeId": node_id, "variables": __cf_snapshot(namespace)}
    __cf_sys.stdout.write("__CFTRACE__" + __cf_json.dumps(event, ensure_ascii=False) + "\n")

def __cf_test(node_id, namespace, value):
    __cf_emit(node_id, namespace)
    return value
'''


def _limits() -> None:
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    except (ValueError, OSError):
        pass


def _anchor_nodes(analysis: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in analysis["studentFlowchart"]["nodes"]:
        for anchor in node.get("sourceAnchors", []):
            result[anchor] = node["id"]
    return result


def _fact_key(node: ast.AST) -> tuple[int, int, int, int]:
    return (
        int(getattr(node, "lineno", 0)),
        int(getattr(node, "col_offset", 0)) + 1,
        int(getattr(node, "end_lineno", getattr(node, "lineno", 0))),
        int(getattr(node, "end_col_offset", 0)) + 1,
    )


def _emit_statement(node_id: str, template: ast.AST) -> ast.Expr:
    statement = ast.Expr(
        value=ast.Call(
            func=ast.Name(id="__cf_emit", ctx=ast.Load()),
            args=[
                ast.Constant(node_id),
                ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[]),
            ],
            keywords=[],
        )
    )
    return ast.copy_location(statement, template)


class _Instrumenter(ast.NodeTransformer):
    def __init__(self, analysis: dict[str, Any]):
        self.notes: dict[str, str] = {}
        self.function_depth = 0
        anchor_nodes = _anchor_nodes(analysis)
        self.nodes: dict[tuple[int, int, int, int], tuple[str, dict[str, Any]]] = {}
        for fact in analysis["facts"]:
            if not fact.get("flowchartRequired"):
                continue
            node_id = anchor_nodes.get(fact["anchor"])
            if not node_id:
                continue
            key = (
                fact["startLine"], fact["startColumn"],
                fact["endLine"], fact["endColumn"],
            )
            self.nodes[key] = (node_id, fact)
            self.notes[node_id] = fact["text"]
        self.start_id = next(
            node["id"] for node in analysis["studentFlowchart"]["nodes"]
            if node["kind"] == "start"
        )
        self.notes[self.start_id] = "Begin the function."

    def _mapping(self, node: ast.AST) -> tuple[str, dict[str, Any]] | None:
        return self.nodes.get(_fact_key(node))

    def visit_FunctionDef(self, node: ast.FunctionDef):  # noqa: N802
        if self.function_depth:
            raise PythonTraceError("Nested function definitions are not supported by the tracer.")
        self.function_depth += 1
        node = self.generic_visit(node)
        self.function_depth -= 1
        node.body.insert(0, _emit_statement(self.start_id, node))
        return node

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):  # noqa: N802
        raise PythonTraceError("Async functions are not supported by the tracer.")

    def visit_If(self, node: ast.If):  # noqa: N802
        mapping = self._mapping(node)
        node = self.generic_visit(node)
        if mapping:
            node_id, _fact = mapping
            node.test = ast.copy_location(ast.Call(
                func=ast.Name(id="__cf_test", ctx=ast.Load()),
                args=[
                    ast.Constant(node_id),
                    ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[]),
                    node.test,
                ],
                keywords=[],
            ), node.test)
        return node

    def visit_While(self, node: ast.While):  # noqa: N802
        if node.orelse:
            raise PythonTraceError("Loop else clauses are not supported by the tracer.")
        mapping = self._mapping(node)
        node = self.generic_visit(node)
        if not mapping:
            return node
        node_id, _fact = mapping
        node.test = ast.copy_location(ast.Call(
            func=ast.Name(id="__cf_test", ctx=ast.Load()),
            args=[
                ast.Constant(node_id),
                ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[]),
                node.test,
            ],
            keywords=[],
        ), node.test)
        return node

    def visit_For(self, node: ast.For):  # noqa: N802
        if node.orelse:
            raise PythonTraceError("Loop else clauses are not supported by the tracer.")
        if any(isinstance(child, (ast.Break, ast.Continue)) for child in ast.walk(node)):
            raise PythonTraceError("Loop break and continue are not supported by the tracer.")
        mapping = self._mapping(node)
        node = self.generic_visit(node)
        if not mapping:
            return node
        node_id, _fact = mapping
        event = _emit_statement(node_id, node)
        node.body.insert(0, event)
        return [node, _emit_statement(node_id, node)]

    def visit_AsyncFor(self, node: ast.AsyncFor):  # noqa: N802
        raise PythonTraceError("Async loops are not supported by the tracer.")

    def visit_Return(self, node: ast.Return):  # noqa: N802
        mapping = self._mapping(node)
        node = self.generic_visit(node)
        if not mapping:
            return node
        return [_emit_statement(mapping[0], node), node]

    def _process(self, node: ast.stmt):
        mapping = self._mapping(node)
        node = self.generic_visit(node)
        if not mapping:
            return node
        return [node, _emit_statement(mapping[0], node)]

    def visit_Assign(self, node: ast.Assign):  # noqa: N802
        return self._process(node)

    def visit_AnnAssign(self, node: ast.AnnAssign):  # noqa: N802
        return self._process(node)

    def visit_AugAssign(self, node: ast.AugAssign):  # noqa: N802
        return self._process(node)

    def visit_Expr(self, node: ast.Expr):  # noqa: N802
        return self._process(node)


def _validate_call(call: str, function_name: str) -> str:
    try:
        expression = ast.parse(call.strip(), mode="eval").body
    except SyntaxError as error:
        raise PythonTraceError("Enter a valid Python function call to trace.") from error
    if not isinstance(expression, ast.Call):
        raise PythonTraceError("The trace input must be a function call.")
    if not isinstance(expression.func, ast.Name) or expression.func.id != function_name:
        raise PythonTraceError(f'The trace input must call "{function_name}".')
    if expression.keywords or any(isinstance(arg, ast.Starred) for arg in expression.args):
        raise PythonTraceError("Keyword and unpacked trace arguments are not supported.")
    try:
        for argument in expression.args:
            ast.literal_eval(argument)
    except (ValueError, TypeError) as error:
        raise PythonTraceError("Trace arguments must be literal values.") from error
    return ast.unparse(expression)


def _instrument(code: str) -> tuple[str, str, dict[str, str]]:
    if "__cf_" in code:
        raise PythonTraceError('Names beginning with "__cf_" are reserved for tracing.')
    analysis = analyze_code("python", code)
    if analysis["parseStatus"] != "clean" or analysis["compileIssues"]:
        raise PythonTraceError("The Python source must have valid syntax before it can be traced.")
    if len(analysis["functions"]) != 1:
        raise PythonTraceError("Exactly one function definition is required for tracing.")
    try:
        module = ast.parse(code, mode="exec")
    except SyntaxError as error:
        raise PythonTraceError("The Python source could not be parsed.") from error
    unsupported = (ast.AsyncFunctionDef, ast.Yield, ast.YieldFrom, ast.Await,
                   ast.Try, ast.With, ast.ClassDef, ast.Match, ast.Break, ast.Continue,
                   ast.NamedExpr)
    if any(isinstance(node, unsupported) for node in ast.walk(module)):
        raise PythonTraceError("This Python construct is not supported by the tracer.")
    function_name = analysis["functions"][0]["name"]
    if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
           and node.func.id == function_name for node in ast.walk(module)):
        raise PythonTraceError("Recursive functions are not supported by the tracer.")
    instrumenter = _Instrumenter(analysis)
    module = instrumenter.visit(module)
    ast.fix_missing_locations(module)
    return ast.unparse(module), function_name, instrumenter.notes


def trace_python(code: str, call: str) -> dict[str, Any]:
    instrumented, function_name, notes = _instrument(code)
    validated_call = _validate_call(call, function_name)
    harness = (
        f"\n__cf_result = {validated_call}\n"
        "__cf_sys.stdout.write('__CFRESULT__' + __cf_value(__cf_result) + '\\n')\n"
    )
    complete_source = _RUNTIME + "\n" + instrumented + harness

    with tempfile.TemporaryDirectory(prefix="codeflow-python-trace-") as directory:
        source_path = Path(directory) / "trace.py"
        source_path.write_text(complete_source, encoding="utf-8")
        try:
            with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
                completed = subprocess.run(
                    [sys.executable, "-I", "-S", str(source_path)],
                    stdout=output, stderr=errors,
                    timeout=RUN_TIMEOUT_SECONDS,
                    check=False,
                    cwd=directory,
                    preexec_fn=_limits if os.name == "posix" else None,
                    env={"PYTHONIOENCODING": "utf-8"},
                )
                output.seek(0)
                stdout = output.read(1024 * 1024).decode("utf-8", errors="replace")
        except subprocess.TimeoutExpired as error:
            raise PythonTraceError("Execution did not terminate within the trace limit.") from error
        except OSError as error:
            raise PythonTraceError("The trace program could not be executed.") from error

    steps: list[dict[str, Any]] = []
    final_output = ""
    for line in stdout.splitlines():
        if line.startswith(TRACE_PREFIX) and len(steps) < MAX_TRACE_STEPS:
            try:
                event = json.loads(line[len(TRACE_PREFIX):])
            except json.JSONDecodeError:
                continue
            node_id = event.get("nodeId")
            variables = event.get("variables")
            if isinstance(node_id, str) and isinstance(variables, dict):
                steps.append({
                    "nodeId": node_id,
                    "variables": variables,
                    "note": notes.get(node_id, "Execute this step."),
                })
        elif line.startswith(RESULT_PREFIX):
            final_output = line[len(RESULT_PREFIX):].strip()

    if not steps:
        raise PythonTraceError("Execution produced no trace events.")
    if completed.returncode != 0:
        raise PythonTraceError("The program stopped with a runtime error while tracing.")
    return {
        "steps": steps,
        "finalOutput": final_output,
        "truncated": len(steps) >= MAX_TRACE_STEPS,
    }


def trace_pair(student_code: str, recommended_code: str, call: str) -> dict[str, Any]:
    return {
        "student": trace_python(student_code, call),
        "llm": trace_python(recommended_code, call),
        "source": "instrumented-python",
    }
