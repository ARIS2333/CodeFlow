"""Error-tolerant source analysis used to ground LLM flowchart generation.

Tree-sitter deliberately returns a useful concrete syntax tree even when the
student's code is incomplete.  We turn the parts it can identify with
confidence into a small, language-neutral list of facts.  The LLM still makes
the pedagogical flowchart, but it must account for these source-backed anchors
instead of reconstructing the student's control flow from memory alone.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from tree_sitter import Language, Node, Parser
import tree_sitter_java
import tree_sitter_python


MAX_SOURCE_BYTES = 100_000
MAX_FACTS = 300
MAX_SYNTAX_ISSUES = 100


CONTROL_TYPES: dict[str, dict[str, str]] = {
    "java": {
        "if_statement": "if",
        "while_statement": "while",
        "for_statement": "for",
        "enhanced_for_statement": "for-each",
        "do_statement": "do-while",
        "switch_expression": "switch",
    },
    "python": {
        "if_statement": "if",
        "elif_clause": "else-if",
        "while_statement": "while",
        "for_statement": "for",
        "try_statement": "try",
        "match_statement": "match",
    },
}

FUNCTION_TYPES: dict[str, set[str]] = {
    "java": {"method_declaration", "constructor_declaration"},
    "python": {"function_definition"},
}

PROCESS_TYPES: dict[str, set[str]] = {
    "java": {
        "local_variable_declaration",
        "expression_statement",
        "assert_statement",
    },
    "python": {
        "expression_statement",
        "assert_statement",
        "pass_statement",
    },
}

EXIT_TYPES: dict[str, dict[str, tuple[str, str]]] = {
    "java": {
        "return_statement": ("terminal", "return"),
        "throw_statement": ("terminal", "throw"),
        "break_statement": ("process", "break"),
        "continue_statement": ("process", "continue"),
    },
    "python": {
        "return_statement": ("terminal", "return"),
        "raise_statement": ("terminal", "raise"),
        "break_statement": ("process", "break"),
        "continue_statement": ("process", "continue"),
    },
}

SEQUENCE_CONTAINERS = {
    "block",
    "module",
    "program",
    "switch_block_statement_group",
}


def _is_directly_unreachable(node: Node, language: str) -> bool:
    """Conservatively spot facts after an unconditional exit in one block.

    This intentionally does not attempt full data-flow analysis. It only marks
    the unambiguous case where an earlier sibling in the same sequential block
    is return/throw/raise/break/continue. More complex reachability remains the
    reviewer's job.
    """
    parent = node.parent
    if parent is None or parent.type not in SEQUENCE_CONTAINERS:
        return False

    exit_node_types = set(EXIT_TYPES[language])
    for sibling in parent.named_children:
        if sibling.id == node.id:
            break
        if sibling.type in exit_node_types:
            return True
    return False


class CodeAnalysisError(ValueError):
    """The source could not be analysed because the request is invalid."""


@lru_cache(maxsize=2)
def _language(language: str) -> Language:
    if language == "java":
        return Language(tree_sitter_java.language())
    if language == "python":
        return Language(tree_sitter_python.language())
    raise CodeAnalysisError(f"Unsupported language: {language}")


def _source_text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _compact(text: str, limit: int = 500) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 1]}…"


def _position(node: Node) -> dict[str, int]:
    return {
        "startLine": node.start_point.row + 1,
        "startColumn": node.start_point.column + 1,
        "endLine": node.end_point.row + 1,
        "endColumn": node.end_point.column + 1,
        "startByte": node.start_byte,
        "endByte": node.end_byte,
    }


def _child_field(parent: Node, child: Node) -> str | None:
    for index, candidate in enumerate(parent.children):
        if candidate.id == child.id:
            return parent.field_name_for_child(index)
    return None


def _header_text(node: Node, source: bytes) -> str:
    """Return the exact control header without copying its whole body."""
    body = (
        node.child_by_field_name("consequence")
        or node.child_by_field_name("body")
    )
    if node.type == "do_statement" and body is not None:
        before_body = source[node.start_byte : body.start_byte].decode(
            "utf-8", errors="replace"
        )
        after_body = source[body.end_byte : node.end_byte].decode(
            "utf-8", errors="replace"
        )
        return _compact(f"{before_body} … {after_body}")
    if body is not None and body.start_byte > node.start_byte:
        return _compact(
            source[node.start_byte : body.start_byte].decode(
                "utf-8", errors="replace"
            )
        )
    return _compact(_source_text(node, source))


def _context_for_child(
    parent: Node,
    child: Node,
    anchor: str,
    inherited_branch: str,
) -> tuple[str, str]:
    field = _child_field(parent, child)

    if field == "consequence":
        return anchor, "true"
    if field == "alternative":
        return anchor, "false"
    if field == "body":
        return anchor, "body"

    # Python exposes else/elif clauses as named children.  Depending on the
    # grammar version there may be more than one child named "alternative".
    if child.type in {"elif_clause", "else_clause"}:
        return anchor, "false"

    return anchor, inherited_branch


def _syntax_issues(root: Node, source: bytes) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()

    def visit(node: Node) -> None:
        issue: dict[str, Any] | None = None
        if node.is_missing:
            issue = {
                "kind": "missing-token",
                "expected": node.type,
                "text": "",
                **_position(node),
            }
        elif node.type == "ERROR":
            issue = {
                "kind": "unexpected-or-incomplete-syntax",
                "text": _compact(_source_text(node, source)),
                **_position(node),
            }

        if issue is not None:
            key = (
                issue["kind"],
                issue["startByte"],
                issue["endByte"],
                issue.get("expected"),
            )
            if key not in seen and len(issues) < MAX_SYNTAX_ISSUES:
                seen.add(key)
                issue["id"] = f"syntax-{len(issues) + 1}"
                issues.append(issue)

        for child in node.children:
            visit(child)

    visit(root)
    return issues


def analyze_code(language: str, code: str) -> dict[str, Any]:
    """Return source-backed structural facts for Java or Python code."""
    if not isinstance(language, str):
        raise CodeAnalysisError("Language must be a string.")
    normalized_language = language.strip().lower()
    if normalized_language not in CONTROL_TYPES:
        raise CodeAnalysisError(
            f'Unsupported language "{language}". Expected "java" or "python".'
        )
    if not isinstance(code, str) or not code.strip():
        raise CodeAnalysisError("Code must be a non-empty string.")

    source = code.encode("utf-8")
    if len(source) > MAX_SOURCE_BYTES:
        raise CodeAnalysisError(
            f"Code is too large to analyse ({len(source)} bytes; "
            f"maximum {MAX_SOURCE_BYTES})."
        )

    parser = Parser(_language(normalized_language))
    tree = parser.parse(source)
    if tree is None:
        raise CodeAnalysisError("Tree-sitter did not return a syntax tree.")

    facts: list[dict[str, Any]] = []
    functions: list[dict[str, Any]] = []
    counters = {"control": 0, "process": 0, "terminal": 0}
    facts_truncated = False

    def add_fact(
        *,
        kind: str,
        construct: str,
        text: str,
        node: Node,
        parent_anchor: str | None,
        branch: str,
        function_name: str | None,
    ) -> str | None:
        nonlocal facts_truncated
        if len(facts) >= MAX_FACTS:
            facts_truncated = True
            return None

        counter_key = "control" if kind == "condition" else kind
        counters[counter_key] += 1
        prefix = {
            "control": "c",
            "process": "p",
            "terminal": "t",
        }[counter_key]
        anchor = f"{prefix}{counters[counter_key]}"
        facts.append(
            {
                "anchor": anchor,
                "kind": kind,
                "construct": construct,
                "text": text,
                "parentAnchor": parent_anchor,
                "branch": branch,
                "function": function_name,
                "flowchartRequired": not _is_directly_unreachable(
                    node, normalized_language
                ),
                **_position(node),
            }
        )
        return anchor

    def visit(
        node: Node,
        parent_anchor: str | None = None,
        branch: str = "sequence",
        function_name: str | None = None,
    ) -> str | None:
        node_type = node.type

        if node_type in FUNCTION_TYPES[normalized_language]:
            name_node = node.child_by_field_name("name")
            name = (
                _compact(_source_text(name_node, source))
                if name_node is not None
                else f"anonymous-{len(functions) + 1}"
            )
            functions.append(
                {
                    "name": name,
                    "construct": node_type,
                    **_position(node),
                }
            )
            for child in node.named_children:
                visit(child, None, "sequence", name)
            return None

        control_construct = CONTROL_TYPES[normalized_language].get(node_type)
        if control_construct is not None:
            anchor = add_fact(
                kind="condition",
                construct=control_construct,
                text=_header_text(node, source),
                node=node,
                parent_anchor=parent_anchor,
                branch=branch,
                function_name=function_name,
            )
            effective_anchor = anchor or parent_anchor

            # Python keeps every elif/else as a sibling alternative of the
            # original if.  Chain their parent anchors explicitly so the final
            # else belongs to the last elif's false branch, not directly to the
            # first if.
            false_parent = effective_anchor
            for child in node.named_children:
                field = _child_field(node, child)
                is_structural_child = field in {
                    "consequence",
                    "alternative",
                    "body",
                } or child.type in {
                    "elif_clause",
                    "else_clause",
                    "catch_clause",
                    "finally_clause",
                    "except_clause",
                }
                # Initializers, conditions, and update expressions are already
                # represented by the control header. Traversing them could
                # duplicate a for-loop initializer as a process fact.
                if not is_structural_child:
                    continue
                child_parent, child_branch = _context_for_child(
                    node,
                    child,
                    effective_anchor or "",
                    branch,
                )
                result_anchor = visit(
                    child,
                    (
                        false_parent
                        if child.type in {"elif_clause", "else_clause"}
                        else child_parent or parent_anchor
                    ),
                    child_branch,
                    function_name,
                )
                if child.type == "elif_clause" and result_anchor:
                    false_parent = result_anchor
            return anchor

        if node_type == "else_clause":
            for child in node.named_children:
                visit(child, parent_anchor, "false", function_name)
            return None

        exit_details = EXIT_TYPES[normalized_language].get(node_type)
        if exit_details is not None:
            kind, construct = exit_details
            add_fact(
                kind=kind,
                construct=construct,
                text=_compact(_source_text(node, source)),
                node=node,
                parent_anchor=parent_anchor,
                branch=branch,
                function_name=function_name,
            )
            return None

        if node_type in PROCESS_TYPES[normalized_language]:
            add_fact(
                kind="process",
                construct=node_type.replace("_statement", "").replace("_", "-"),
                text=_compact(_source_text(node, source)),
                node=node,
                parent_anchor=parent_anchor,
                branch=branch,
                function_name=function_name,
            )
            return None

        for child in node.named_children:
            visit(child, parent_anchor, branch, function_name)
        return None

    visit(tree.root_node)

    syntax_issues = _syntax_issues(tree.root_node, source)
    if tree.root_node.has_error and not syntax_issues:
        syntax_issues.append(
            {
                "id": "syntax-1",
                "kind": "unlocated-parse-error",
                "text": "Tree-sitter reported a parse error without a precise node.",
                **_position(tree.root_node),
            }
        )

    return {
        "analysisVersion": 1,
        "language": normalized_language,
        "parser": "tree-sitter",
        "parseStatus": "recovered" if syntax_issues else "clean",
        "source": {
            "byteCount": len(source),
            "lineCount": code.count("\n") + 1,
        },
        "functions": functions,
        "facts": facts,
        "syntaxIssues": syntax_issues,
        "factsTruncated": facts_truncated,
    }
