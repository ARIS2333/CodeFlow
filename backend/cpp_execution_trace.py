"""Deterministic, bounded execution tracing for the four C++ study tasks.

The tracer never asks a model to rewrite or simulate student code.  It uses the
same Tree-sitter facts that build the visible CFG, inserts small event calls,
compiles a temporary program, and maps its events back to flowchart node IDs.
"""

from __future__ import annotations

import json
import os
import re
import resource
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tree_sitter import Node, Parser

from code_analysis import _language, analyze_code


MAX_TRACE_STEPS = 120
TRACE_PREFIX = "__CFTRACE__"
RESULT_PREFIX = "__CFRESULT__"
# Render's smallest instances can spend several seconds starting g++ and
# parsing the injected support templates. Keep this separate from the much
# shorter syntax-check timeout used by code_analysis.py: a trace compilation
# builds a complete executable for both visible sides.
COMPILE_TIMEOUT_SECONDS = float(
    os.getenv("CPP_TRACE_COMPILE_TIMEOUT_SECONDS", "30")
)
RUN_TIMEOUT_SECONDS = float(os.getenv("CPP_TRACE_RUN_TIMEOUT_SECONDS", "3"))


class CppTraceError(RuntimeError):
    """The source could not be traced without guessing."""


@dataclass(frozen=True)
class Variable:
    name: str
    declared_at: int
    scope_start: int
    scope_end: int


_RUNTIME = r'''
#include <iostream>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

static std::string __cf_escape(const std::string& value) {
    std::ostringstream out;
    for (unsigned char ch : value) {
        switch (ch) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) out << "\\u" << std::hex << std::setw(4)
                                   << std::setfill('0') << static_cast<int>(ch);
                else out << static_cast<char>(ch);
        }
    }
    return out.str();
}

template <typename T> static std::string __cf_value(const T&) { return "<unavailable>"; }
static std::string __cf_value(const std::string& value) { return "\"" + __cf_escape(value) + "\""; }
static std::string __cf_value(const char* value) { return __cf_value(std::string(value)); }
static std::string __cf_value(char value) { return "'" + __cf_escape(std::string(1, value)) + "'"; }
static std::string __cf_value(bool value) { return value ? "true" : "false"; }
template <typename T, typename std::enable_if<std::is_integral<T>::value &&
    !std::is_same<T, bool>::value && !std::is_same<T, char>::value, int>::type = 0>
static std::string __cf_number(T value) { return std::to_string(value); }
static std::string __cf_value(short value) { return __cf_number(value); }
static std::string __cf_value(unsigned short value) { return __cf_number(value); }
static std::string __cf_value(int value) { return __cf_number(value); }
static std::string __cf_value(unsigned int value) { return __cf_number(value); }
static std::string __cf_value(long value) { return __cf_number(value); }
static std::string __cf_value(unsigned long value) { return __cf_number(value); }
static std::string __cf_value(long long value) { return __cf_number(value); }
static std::string __cf_value(unsigned long long value) { return __cf_number(value); }
static std::string __cf_value(float value) { std::ostringstream out; out << value; return out.str(); }
static std::string __cf_value(double value) { std::ostringstream out; out << value; return out.str(); }

template <typename A, typename B>
static std::string __cf_value(const std::pair<A, B>& value) {
    return "{" + __cf_value(value.first) + ", " + __cf_value(value.second) + "}";
}
template <typename It>
static std::string __cf_range(It begin, It end, const char* open, const char* close) {
    std::string out(open); int count = 0;
    for (It it = begin; it != end && count < 20; ++it, ++count) {
        if (count) out += ", ";
        out += __cf_value(*it);
    }
    if (begin != end && count == 20) out += ", …";
    return out + close;
}
template <typename T, typename A>
static std::string __cf_value(const std::vector<T, A>& value) {
    return __cf_range(value.begin(), value.end(), "[", "]");
}
template <typename T, std::size_t N>
static std::string __cf_value(const T (&value)[N]) {
    return __cf_range(value, value + N, "[", "]");
}
template <typename T, typename C, typename A>
static std::string __cf_value(const std::set<T, C, A>& value) {
    return __cf_range(value.begin(), value.end(), "{", "}");
}
template <typename T, typename H, typename E, typename A>
static std::string __cf_value(const std::unordered_set<T, H, E, A>& value) {
    return __cf_range(value.begin(), value.end(), "{", "}");
}
template <typename K, typename V, typename C, typename A>
static std::string __cf_value(const std::map<K, V, C, A>& value) {
    std::string out("{"); int count = 0;
    for (auto it = value.begin(); it != value.end() && count < 20; ++it, ++count) {
        if (count) out += ", ";
        out += __cf_value(it->first) + ": " + __cf_value(it->second);
    }
    if (!value.empty() && count == 20) out += ", …";
    return out + "}";
}
template <typename K, typename V, typename H, typename E, typename A>
static std::string __cf_value(const std::unordered_map<K, V, H, E, A>& value) {
    std::string out("{"); int count = 0;
    for (auto it = value.begin(); it != value.end() && count < 20; ++it, ++count) {
        if (count) out += ", ";
        out += __cf_value(it->first) + ": " + __cf_value(it->second);
    }
    if (!value.empty() && count == 20) out += ", …";
    return out + "}";
}

static int __cf_steps = 0;
static void __cf_emit(const char* node,
                      std::initializer_list<std::pair<const char*, std::string>> variables = {}) {
    if (__cf_steps++ >= 120) return;
    std::cout << "__CFTRACE__{\"nodeId\":\"" << __cf_escape(node)
              << "\",\"variables\":{";
    bool first = true;
    for (const auto& item : variables) {
        if (!first) std::cout << ',';
        first = false;
        std::cout << '\"' << __cf_escape(item.first) << "\":\""
                  << __cf_escape(item.second) << '\"';
    }
    std::cout << "}}\n";
}
'''


def _identifier(node: Node | None, source: bytes) -> str | None:
    if node is None:
        return None
    if node.type in {"identifier", "field_identifier"}:
        return source[node.start_byte : node.end_byte].decode("utf-8")
    declarator = node.child_by_field_name("declarator")
    if declarator is not None:
        found = _identifier(declarator, source)
        if found:
            return found
    for child in node.named_children:
        found = _identifier(child, source)
        if found:
            return found
    return None


def _field(parent: Node, child: Node) -> str | None:
    for index, candidate in enumerate(parent.children):
        if candidate.id == child.id:
            return parent.field_name_for_child(index)
    return None


def _nearest_scope(node: Node, function_body: Node) -> Node:
    parent = node.parent
    while parent is not None and parent.id != function_body.id:
        if parent.type == "compound_statement":
            return parent
        parent = parent.parent
    return function_body


def _variables(function: Node, source: bytes) -> list[Variable]:
    body = function.child_by_field_name("body")
    if body is None:
        return []
    result: list[Variable] = []
    seen: set[tuple[str, int, int]] = set()

    declarator = function.child_by_field_name("declarator")
    parameters = declarator.child_by_field_name("parameters") if declarator else None
    if parameters is not None:
        for parameter in parameters.named_children:
            if parameter.type != "parameter_declaration":
                continue
            name = _identifier(parameter.child_by_field_name("declarator"), source)
            if name:
                result.append(Variable(name, body.start_byte, body.start_byte, body.end_byte))

    def add(name: str | None, declared_at: int, scope: Node) -> None:
        if not name:
            return
        key = (name, scope.start_byte, scope.end_byte)
        if key not in seen:
            seen.add(key)
            result.append(Variable(name, declared_at, scope.start_byte, scope.end_byte))

    def visit(node: Node) -> None:
        if node.type == "declaration":
            # A classic for-loop initializer is scoped to the loop, not the
            # surrounding block. The for_statement branch below handles it.
            if not (
                node.parent is not None
                and node.parent.type == "for_statement"
                and _field(node.parent, node) == "initializer"
            ):
                scope = _nearest_scope(node, body)
                for index, child in enumerate(node.children):
                    if node.field_name_for_child(index) == "declarator":
                        add(_identifier(child, source), node.end_byte, scope)
        elif node.type == "for_range_loop":
            loop_body = node.child_by_field_name("body")
            add(
                _identifier(node.child_by_field_name("declarator"), source),
                loop_body.start_byte if loop_body else node.start_byte,
                loop_body or node,
            )
        elif node.type == "for_statement":
            initializer = node.child_by_field_name("initializer")
            if initializer is not None and initializer.type == "declaration":
                for index, child in enumerate(initializer.children):
                    if initializer.field_name_for_child(index) == "declarator":
                        add(_identifier(child, source), initializer.end_byte, node)
        for child in node.named_children:
            visit(child)

    visit(body)
    return result


def _emit(node_id: str, variables: list[Variable], position: int) -> str:
    visible = [
        variable for variable in variables
        if variable.declared_at <= position
        and variable.scope_start <= position < variable.scope_end
    ][:8]
    entries = ", ".join(
        f'{{"{variable.name}", __cf_value({variable.name})}}' for variable in visible
    )
    return f'__cf_emit("{node_id}", {{{entries}}});'


def _node_index(root: Node) -> dict[tuple[int, int], Node]:
    result: dict[tuple[int, int], Node] = {}
    def visit(node: Node) -> None:
        result[(node.start_byte, node.end_byte)] = node
        for child in node.named_children:
            visit(child)
    visit(root)
    return result


def _anchor_nodes(analysis: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in analysis["studentFlowchart"]["nodes"]:
        for anchor in node.get("sourceAnchors", []):
            result[anchor] = node["id"]
    return result


def _instrument(code: str) -> tuple[str, dict[str, str]]:
    analysis = analyze_code("cpp", code)
    if analysis["compilerStatus"] != "passed":
        raise CppTraceError("The C++ source must compile before it can be traced.")
    if len(analysis["functions"]) != 1:
        raise CppTraceError("Exactly one function definition is required for tracing.")

    source = code.encode("utf-8")
    tree = Parser(_language("cpp")).parse(source)
    if tree is None:
        raise CppTraceError("Tree-sitter could not parse the source.")
    function = next(
        (node for node in _node_index(tree.root_node).values()
         if node.type == "function_definition"),
        None,
    )
    if function is None:
        raise CppTraceError("No C++ function definition was found.")
    body = function.child_by_field_name("body")
    if body is None:
        raise CppTraceError("The function has no body.")

    variables = _variables(function, source)
    nodes = _node_index(tree.root_node)
    anchor_nodes = _anchor_nodes(analysis)
    inserts: dict[int, list[tuple[int, str]]] = {}

    def insert(position: int, text: str, order: int = 0) -> None:
        inserts.setdefault(position, []).append((order, text))

    start_id = next(
        node["id"] for node in analysis["studentFlowchart"]["nodes"]
        if node["kind"] == "start"
    )
    insert(body.start_byte + 1, _emit(start_id, variables, body.start_byte + 1), 10)

    notes: dict[str, str] = {start_id: "Begin the function."}
    for fact in analysis["facts"]:
        if not fact.get("flowchartRequired"):
            continue
        node_id = anchor_nodes.get(fact["anchor"])
        syntax_node = nodes.get((fact["startByte"], fact["endByte"]))
        if not node_id or syntax_node is None:
            continue
        notes[node_id] = fact["text"]
        event = _emit(node_id, variables, fact["endByte"])

        if fact["kind"] == "condition":
            condition = syntax_node.child_by_field_name("condition")
            if condition is not None:
                condition_event = _emit(node_id, variables, condition.start_byte)
                insert(condition.start_byte, f'({condition_event[:-1]}, ', 20)
                insert(condition.end_byte, ")", 0)
                continue
            if syntax_node.type == "for_range_loop":
                loop_body = syntax_node.child_by_field_name("body")
                if loop_body is None:
                    continue
                loop_event = _emit(node_id, variables, loop_body.start_byte + 1)
                if loop_body.type == "compound_statement":
                    insert(loop_body.start_byte + 1, loop_event, 20)
                else:
                    insert(loop_body.start_byte, "{" + loop_event, 30)
                    insert(loop_body.end_byte, "}", 30)
                insert(syntax_node.end_byte, _emit(node_id, variables, syntax_node.end_byte), 0)
                continue
            # Unknown control forms are deliberately unsupported rather than
            # producing a plausible but false path.
            raise CppTraceError(f'Unsupported control construct: {fact["construct"]}.')

        direct_control_body = False
        parent = syntax_node.parent
        if parent is not None:
            direct_control_body = (
                parent.type in {
                    "if_statement", "while_statement", "do_statement",
                    "for_statement", "for_range_loop",
                }
                and _field(parent, syntax_node) in {"consequence", "alternative", "body"}
                and syntax_node.type != "compound_statement"
            )

        if fact["kind"] == "terminal":
            prefix = "{" if direct_control_body else ""
            suffix = "}" if direct_control_body else ""
            insert(syntax_node.start_byte, prefix + event, 40)
            if suffix:
                insert(syntax_node.end_byte, suffix, 40)
        else:
            if direct_control_body:
                insert(syntax_node.start_byte, "{", 40)
                insert(syntax_node.end_byte, event + "}", 40)
            else:
                insert(syntax_node.end_byte, event, 40)

    instrumented = code
    encoded = instrumented.encode("utf-8")
    for position in sorted(inserts, reverse=True):
        payload = "".join(text for _order, text in sorted(inserts[position]))
        encoded = encoded[:position] + payload.encode("utf-8") + encoded[position:]
    return _RUNTIME + "\n" + encoded.decode("utf-8"), notes


_INTEGER = r"[+-]?\d+"
_VECTOR = rf"\{{\s*(?:{_INTEGER}(?:\s*,\s*{_INTEGER})*)?\s*\}}"
_STRING = r'"(?:[^"\\]|\\.)*"'


def _harness(function_name: str, call: str) -> str:
    escaped = re.escape(function_name)
    if function_name == "isNumUnique":
        match = re.fullmatch(rf"\s*{escaped}\s*\(\s*({_INTEGER})\s*\)\s*", call)
        if not match:
            raise CppTraceError("Use an input such as isNumUnique(1234).")
        setup = f"auto __cf_result = {function_name}({match.group(1)});"
    elif function_name == "two_sum":
        match = re.fullmatch(rf"\s*{escaped}\s*\(\s*({_VECTOR})\s*,\s*({_INTEGER})\s*\)\s*", call)
        if not match:
            raise CppTraceError("Use an input such as two_sum({2, 7}, 9).")
        setup = (
            f"std::vector<int> __cf_arg0 = {match.group(1)};"
            f"auto __cf_result = {function_name}(__cf_arg0, {match.group(2)});"
        )
    elif function_name == "findTheDigits":
        match = re.fullmatch(rf"\s*{escaped}\s*\(\s*({_STRING})\s*,\s*({_STRING})\s*\)\s*", call)
        if not match:
            raise CppTraceError('Use an input such as findTheDigits("12", "123").')
        setup = f"auto __cf_result = {function_name}({match.group(1)}, {match.group(2)});"
    elif function_name == "findMode":
        match = re.fullmatch(rf"\s*{escaped}\s*\(\s*({_VECTOR})\s*\)\s*", call)
        if not match:
            raise CppTraceError("Use an input such as findMode({1, 1, 2}).")
        setup = (
            f"std::vector<int> __cf_arg0 = {match.group(1)};"
            f"auto __cf_result = {function_name}(__cf_arg0);"
        )
    else:
        raise CppTraceError(f'Tracing is not configured for function "{function_name}".')
    return (
        "\nint main() {"
        + setup
        + 'std::cout << "__CFRESULT__" << __cf_value(__cf_result) << "\\n";'
        + "return 0;}\n"
    )


def _limits() -> None:
    """Keep a broken submission from monopolising a web worker."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    except (ValueError, OSError):
        pass


def trace_cpp(code: str, call: str) -> dict[str, Any]:
    """Compile and execute one supported function call into the UI trace shape."""
    analysis = analyze_code("cpp", code)
    if len(analysis["functions"]) != 1:
        raise CppTraceError("Exactly one function definition is required for tracing.")
    function_name = analysis["functions"][0]["name"]
    instrumented, notes = _instrument(code)
    complete_source = instrumented + _harness(function_name, call)
    compiler = shutil.which(os.getenv("CXX", "g++"))
    if compiler is None:
        raise CppTraceError("The C++ compiler is unavailable.")

    with tempfile.TemporaryDirectory(prefix="codeflow-trace-") as directory:
        source_path = Path(directory) / "trace.cpp"
        binary_path = Path(directory) / "trace-program"
        source_path.write_text(complete_source, encoding="utf-8")
        try:
            compiled = subprocess.run(
                [compiler, "-std=c++17", "-O0", str(source_path), "-o", str(binary_path)],
                capture_output=True,
                text=True,
                timeout=COMPILE_TIMEOUT_SECONDS,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise CppTraceError("The trace program could not be compiled in time.") from error
        if compiled.returncode != 0:
            raise CppTraceError("Instrumentation could not compile this submission.")

        try:
            completed = subprocess.run(
                [str(binary_path)],
                capture_output=True,
                text=True,
                timeout=RUN_TIMEOUT_SECONDS,
                check=False,
                preexec_fn=_limits if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired as error:
            raise CppTraceError("Execution did not terminate within the trace limit.") from error
        except OSError as error:
            raise CppTraceError("The trace program could not be executed.") from error

    steps: list[dict[str, Any]] = []
    final_output = ""
    for line in completed.stdout.splitlines():
        if line.startswith(TRACE_PREFIX) and len(steps) < MAX_TRACE_STEPS:
            try:
                event = json.loads(line[len(TRACE_PREFIX) :])
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
            final_output = line[len(RESULT_PREFIX) :].strip()

    if not steps:
        raise CppTraceError("Execution produced no trace events.")
    if completed.returncode != 0:
        raise CppTraceError("The program stopped with a runtime error while tracing.")
    return {
        "steps": steps,
        "finalOutput": final_output,
        "truncated": len(steps) >= MAX_TRACE_STEPS,
    }


def trace_pair(student_code: str, recommended_code: str, call: str) -> dict[str, Any]:
    return {
        "student": trace_cpp(student_code, call),
        "llm": trace_cpp(recommended_code, call),
        "source": "instrumented-cpp",
    }
