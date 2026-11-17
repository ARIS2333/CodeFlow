"""Bounded DuckDB SELECT walkthroughs in logical (not physical plan) order."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import duckdb
import sqlglot
from sqlglot import exp


class SqlEducationError(ValueError):
    pass


def validate_tables(tables):
    if not isinstance(tables, list) or not 1 <= len(tables) <= 6:
        raise SqlEducationError('Provide between one and six input tables.')
    names = set()
    for table in tables:
        if not isinstance(table, dict):
            raise SqlEducationError('Invalid table definition.')
        name = table.get('name', '')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name) or name.lower() in names:
            raise SqlEducationError('Table names must be unique SQL identifiers.')
        names.add(name.lower())
        columns, rows = table.get('columns'), table.get('rows')
        if not isinstance(columns, list) or not 1 <= len(columns) <= 20 or not isinstance(rows, list) or len(rows) > 200:
            raise SqlEducationError('Each table supports 1–20 columns and up to 200 rows.')
        column_names = set()
        for column in columns:
            if not isinstance(column, dict):
                raise SqlEducationError('Invalid column definition.')
            column_name = column.get('name', '')
            if not isinstance(column_name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', column_name) or column_name.lower() in column_names:
                raise SqlEducationError('Column names must be unique SQL identifiers.')
            column_names.add(column_name.lower())
            if column.get('type') not in {'INTEGER', 'DOUBLE', 'VARCHAR', 'BOOLEAN', 'DATE', 'TIMESTAMP'}:
                raise SqlEducationError('Column types: INTEGER, DOUBLE, VARCHAR, BOOLEAN, DATE, TIMESTAMP.')
        for row in rows:
            if not isinstance(row, list) or len(row) != len(columns):
                raise SqlEducationError('Every row must match its table columns.')
            if any(value is not None and (type(value) not in (str, int, float, bool) or len(str(value)) > 500) for value in row):
                raise SqlEducationError('Cells must contain short scalar values or null.')


def parse_query(sql, tables):
    if not isinstance(sql, str) or not sql.strip() or len(sql) > 20000:
        raise SqlEducationError('Enter a SELECT query of at most 20,000 characters.')
    try:
        statements = sqlglot.parse(sql, read='duckdb')
    except sqlglot.errors.ParseError as error:
        raise SqlEducationError(str(error)) from error
    if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.SetOperation)):
        raise SqlEducationError('Use one read-only SELECT query (set operations are allowed).')
    query = statements[0]
    if len(list(query.walk())) > 1500 or len(list(query.find_all(exp.Select))) > 20:
        raise SqlEducationError('Use a smaller query for the teaching walkthrough.')
    allowed_args = {'expressions', 'from_', 'joins', 'where', 'group', 'having', 'order',
                    'limit', 'offset', 'distinct', 'with_'}
    allowed_functions = {
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'ABS', 'ROUND',
        'LOWER', 'UPPER', 'LENGTH', 'SUBSTRING', 'CONCAT', 'CONCAT_WS', 'TRIM',
        'LTRIM', 'RTRIM', 'REPLACE', 'CAST', 'TRY_CAST', 'CASE', 'IF', 'EXISTS',
        'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
        'NTILE', 'CEIL', 'FLOOR', 'POWER', 'SQRT', 'EXTRACT', 'DATE_TRUNC',
    }
    for node in query.walk():
        if isinstance(node, exp.Select) and any(value and key not in allowed_args for key, value in node.args.items()):
            raise SqlEducationError('This SELECT clause is not supported in the teaching walkthrough.')
        if isinstance(node, exp.With) and node.args.get('recursive'):
            raise SqlEducationError('Recursive CTEs are not supported.')
        if isinstance(node, (exp.Command, exp.DDL, exp.DML)):
            raise SqlEducationError('Only read-only queries are allowed.')
        if isinstance(node, exp.Func) and not isinstance(node, (exp.And, exp.Or)):
            if isinstance(node, exp.Anonymous) or node.sql_name() not in allowed_functions:
                raise SqlEducationError(f'Function {node.sql_name()} is not supported in this teaching workspace.')
        if isinstance(node, (exp.Limit, exp.Offset)):
            value = node.expression
            if not isinstance(value, exp.Literal) or value.is_string or not re.fullmatch(r'\d+', value.this):
                raise SqlEducationError('LIMIT and OFFSET must be non-negative integer literals.')
    known_tables = {table['name'].lower() for table in tables}
    known_tables.update(cte.alias_or_name.lower() for cte in query.find_all(exp.CTE))
    for table in query.find_all(exp.Table):
        if (not isinstance(table.this, exp.Identifier) or table.catalog or table.db
                or table.name.lower() not in known_tables):
            raise SqlEducationError('Queries may only read the supplied teaching tables and CTEs.')
    for group in query.find_all(exp.Group):
        if any(group.args.get(key) for key in ('cube', 'rollup', 'grouping_sets', 'all')):
            raise SqlEducationError('Use ordinary GROUP BY expressions in this version.')
    for join in query.find_all(exp.Join):
        if join.args.get('method') or join.args.get('kind') in {'SEMI', 'ANTI', 'ASOF'}:
            raise SqlEducationError('Use INNER, LEFT, RIGHT, FULL or CROSS JOIN, with ON or USING.')
    return query


def walkthrough(sql, tables):
    validate_tables(tables)
    query = parse_query(sql, tables)
    connection = duckdb.connect(':memory:', config={
        'enable_external_access': 'false', 'autoinstall_known_extensions': 'false',
        'autoload_known_extensions': 'false', 'threads': '1', 'memory_limit': '128MB',
    })
    try:
        for table in tables:
            columns = ', '.join(f'"{column["name"]}" {column["type"]}' for column in table['columns'])
            connection.execute(f'CREATE TABLE "{table["name"]}" ({columns})')
            if table['rows']:
                placeholders = ', '.join('?' for _ in table['columns'])
                connection.executemany(f'INSERT INTO "{table["name"]}" VALUES ({placeholders})', table['rows'])

        def result(statement):
            cursor = connection.execute(statement)
            rows = cursor.fetchmany(201)
            return {'columns': [column[0] for column in cursor.description],
                    'rows': rows[:200], 'truncated': len(rows) > 200}

        # Verify the exact submitted query first, including binding/type errors.
        final = result(sql)
        steps = []
        notices = []

        def add(label, stage, phase, **details):
            statement = stage.sql(dialect='duckdb')
            item = {'id': str(len(steps) + 1), 'phase': phase, 'label': label,
                    'sql': statement, 'result': result(statement), **details}
            steps.append(item)
            return item

        def contextual(stage, context):
            stage = stage.copy()
            if context:
                stage.set('with_', exp.With(expressions=[cte.copy() for cte in context]))
            return stage

        def explain(current, scope='query', inherited=None, inherited_ids=None):
            context = list(inherited or [])
            previous = None
            cte_steps = dict(inherited_ids or {})

            def emit(label, stage, phase, dependsOn=None, **details):
                nonlocal previous
                item = add(label, stage, phase,
                           dependsOn=dependsOn if dependsOn is not None else ([previous] if previous else []), **details)
                previous = item['id']
                return item

            for cte in (current.args.get('with_') or exp.With()).expressions:
                # A CTE is an independently executable named intermediate relation.
                cte_steps[cte.alias_or_name.lower()] = explain(cte.this, f'{scope}/CTE:{cte.alias_or_name}', context, cte_steps)
                context.append(cte)
            current = current.copy()
            current.set('with_', None)
            if isinstance(current, exp.Subquery):
                return explain(current.this, scope, context, cte_steps)
            if isinstance(current, exp.SetOperation):
                left_id = explain(current.this, scope + '/left', context, cte_steps)
                left = result(contextual(current.this, context).sql(dialect='duckdb'))
                right_id = explain(current.expression, scope + '/right', context, cte_steps)
                right = result(contextual(current.expression, context).sql(dialect='duckdb'))
                operation = current.copy()
                for key in ('order', 'limit', 'offset'):
                    operation.set(key, None)
                kind = current.key.upper() + (' ALL' if current.args.get('distinct') is False else '')
                emit(kind, contextual(operation, context), scope + '/SET:' + kind, dependsOn=[left_id, right_id],
                    inputs=[{'label': 'Left query', 'result': left}, {'label': 'Right query', 'result': right}],
                    inputMode='set')
                for clause in ('order', 'offset', 'limit'):
                    if current.args.get(clause):
                        operation.set(clause, current.args[clause].copy())
                        emit(current.args[clause].sql(dialect='duckdb'), contextual(operation, context), scope + '/' + clause)
                return previous

            stage = contextual(exp.select('*'), context)
            source = current.args.get('from_')
            if source:
                # Derived tables are shown as a nested query before their use.
                dependencies = []
                if isinstance(source.this, exp.Subquery):
                    dependencies.append(explain(source.this.this, scope + '/derived', context, cte_steps))
                elif source.this.name.lower() in cte_steps:
                    dependencies.append(cte_steps[source.this.name.lower()])
                stage.set('from_', source.copy())
                emit(source.sql(dialect='duckdb'), stage, scope + '/from', dependsOn=dependencies)
            for index, join in enumerate(current.args.get('joins') or []):
                dependencies = [previous] if previous else []
                if isinstance(join.this, exp.Subquery):
                    dependencies.append(explain(join.this.this, f'{scope}/join:{index}/derived', context, cte_steps))
                elif join.this.name.lower() in cte_steps:
                    dependencies.append(cte_steps[join.this.name.lower()])
                left = result(stage.sql(dialect='duckdb'))
                right_query = contextual(exp.select('*').from_(join.this.copy()), context)
                right = result(right_query.sql(dialect='duckdb'))
                stage.set('joins', [*(stage.args.get('joins') or []), join.copy()])
                item = emit(join.sql(dialect='duckdb'), stage, f'{scope}/join:{index}', dependsOn=dependencies,
                    inputs=[{'label': 'Left input', 'result': left},
                            {'label': 'Right input: ' + join.this.sql(dialect='duckdb'), 'result': right}],
                    inputMode='join')
                # ON joins keep both input tuples in SELECT *. Equal duplicates
                # are highlighted together; never claim unique provenance for them.
                if not join.args.get('using'):
                    width = len(left['columns'])
                    item['rowLinks'] = [
                        [[i for i, row in enumerate(left['rows']) if list(row) == list(output[:width])],
                         [i for i, row in enumerate(right['rows']) if list(row) == list(output[width:])]]
                        for output in item['result']['rows']]
                    item['linkNote'] = 'Select a joined row to highlight matching input values. Identical tuples are highlighted together. This compares values; padded NULLs cannot be distinguished from identical all-NULL input tuples.'

            if current.args.get('where'):
                before = stage.copy()
                stage.set('where', current.args['where'].copy())
                item = emit(current.args['where'].sql(dialect='duckdb'), stage, scope + '/where')
                predicate = current.args['where'].this.sql(dialect='duckdb')
                item['branches'] = [
                    {'label': 'TRUE · kept', 'result': item['result']},
                    {'label': 'FALSE / NULL · excluded', 'result': result(
                        before.where(f'({predicate}) IS NOT TRUE').sql(dialect='duckdb'))},
                ]
                # Correlated predicates are executed in context by DuckDB, not
                # falsely visualized as independent subquery executions.
                if current.args['where'].find(exp.Select):
                    item['note'] = 'Subquery predicates are evaluated in the enclosing query context, including correlations.'

            before_projection = stage.copy()
            stage.set('expressions', [expression.copy() for expression in current.expressions])
            group = current.args.get('group')
            if group:
                stage.set('group', group.copy())
            label = 'SELECT ' + ', '.join(expression.sql(dialect='duckdb') for expression in current.expressions)
            if group:
                label = group.sql(dialect='duckdb') + ' · ' + label
            combined_window_having = bool(current.args.get('having')) and any(e.find(exp.Window) for e in current.expressions)
            if combined_window_having:
                stage.set('having', current.args['having'].copy())
                label += ' · ' + current.args['having'].sql(dialect='duckdb') + ' · WINDOW'
            item = emit(label, stage, scope + '/select')
            if group:
                source_rows = result(before_projection.sql(dialect='duckdb'))
                item['inputs'] = [{'label': 'Rows before grouping', 'result': source_rows}]
                item['inputMode'] = 'group'
                # Ask the engine for grouping keys alongside both raw and
                # aggregate rows. Resolve positional and SELECT-alias keys.
                keys = []
                aliases = {e.alias: e.this for e in current.expressions if isinstance(e, exp.Alias)}
                for expression in group.expressions:
                    if isinstance(expression, exp.Literal) and not expression.is_string:
                        key = current.expressions[int(expression.this) - 1]
                        keys.append((key.this if isinstance(key, exp.Alias) else key).copy())
                    elif isinstance(expression, exp.Column) and not expression.table and expression.name in aliases:
                        keys.append(aliases[expression.name].copy())
                    else:
                        keys.append(expression.copy())
                raw_keys = before_projection.copy()
                raw_keys.set('expressions', keys)
                grouped_keys = stage.copy()
                grouped_keys.set('expressions', [*stage.expressions, *keys])
                raw = result(raw_keys.sql(dialect='duckdb'))
                grouped = result(grouped_keys.sql(dialect='duckdb'))
                key_count = len(keys)
                # Match by complete aggregate tuple, avoiding assumptions about
                # unspecified GROUP BY row order across two executions.
                item['rowLinks'] = []
                for output in item['result']['rows']:
                    matching_keys = [r[-key_count:] for r in grouped['rows'] if r[:-key_count] == output] if key_count else [()]
                    item['rowLinks'].append([[i for i, key in enumerate(raw['rows']) if key in matching_keys]])
                item['linkNote'] = 'Select a group to highlight its contributing rows. Groups with identical displayed values are highlighted together.'

            elif any(e.find(exp.AggFunc) for e in current.expressions) and not any(e.find(exp.Window) for e in current.expressions):
                source_rows = result(before_projection.sql(dialect='duckdb'))
                item['inputs'] = [{'label': 'Rows contributing to the aggregate', 'result': source_rows}]
                item['inputMode'] = 'group'
                item['rowLinks'] = [[[i for i in range(len(source_rows['rows']))]] for _ in item['result']['rows']]
                item['linkNote'] = 'Select the aggregate row to highlight its input rows. COUNT(column) and most aggregates ignore NULL values.'

            cases = [node for expression in current.expressions for node in expression.find_all(exp.Case)
                     if node.find_ancestor(exp.Select) is current and not node.find_ancestor(exp.Case)]
            # current is a copied AST; CASE nodes in ordinary row projections
            # can be partitioned with exact SQL three-valued predicates.
            if cases and not group and not any(e.find(exp.AggFunc) for e in current.expressions):
                item['caseBranches'] = []
                for case_index, case in enumerate(cases):
                    earlier = []
                    for arm in case.args.get('ifs') or []:
                        condition = (exp.EQ(this=case.this.copy(), expression=arm.this.copy())
                                     if case.this else arm.this.copy())
                        condition_sql = condition.sql(dialect='duckdb')
                        guard = ' AND '.join([*(f'({p}) IS NOT TRUE' for p in earlier), f'({condition_sql}) IS TRUE'])
                        branch = stage.copy()
                        branch.set('expressions', [*branch.expressions, sqlglot.parse_one(guard, read='duckdb')])
                        evaluated = result(branch.sql(dialect='duckdb'))
                        partition = {**item['result'], 'rows': [r[:-1] for r in evaluated['rows'] if r[-1] is True]}
                        item['caseBranches'].append({'caseIndex': case_index, 'label': f'CASE {case_index + 1} · WHEN {condition_sql}',
                                                     'result': partition})
                        earlier.append(condition_sql)
                    guard = ' AND '.join(f'({p}) IS NOT TRUE' for p in earlier) or 'TRUE'
                    branch = stage.copy()
                    branch.set('expressions', [*branch.expressions, sqlglot.parse_one(guard, read='duckdb')])
                    evaluated = result(branch.sql(dialect='duckdb'))
                    partition = {**item['result'], 'rows': [r[:-1] for r in evaluated['rows'] if r[-1] is True]}
                    item['caseBranches'].append({'caseIndex': case_index, 'label': f'CASE {case_index + 1} · ELSE', 'result': partition})
            if any(expression.find(exp.Window) for expression in current.expressions):
                item['note'] = ('Grouping, HAVING and windows are evaluated together here to preserve window values after group filtering. ' if combined_window_having else '') + 'Window functions retain the rows of their input relation, unlike grouping.'
            if current.args.get('having') and not combined_window_having:
                before = stage.copy()
                stage.set('having', current.args['having'].copy())
                item = emit(current.args['having'].sql(dialect='duckdb'), stage, scope + '/having')
                predicate = current.args['having'].this.sql(dialect='duckdb')
                before.set('having', exp.Having(this=sqlglot.parse_one(f'({predicate}) IS NOT TRUE', read='duckdb')))
                item['branches'] = [
                    {'label': 'TRUE · groups kept', 'result': item['result']},
                    {'label': 'FALSE / NULL · groups excluded', 'result': result(before.sql(dialect='duckdb'))},
                ]
            for clause in ('distinct', 'order', 'offset', 'limit'):
                if current.args.get(clause):
                    stage.set(clause, current.args[clause].copy())
                    emit('DISTINCT' if clause == 'distinct' else current.args[clause].sql(dialect='duckdb'), stage, scope + '/' + clause)

            return previous

        try:
            explain(query)
        except duckdb.Error:
            # Valid advanced queries can depend on aliases/correlations that
            # cannot be represented as independently executable SQL prefixes.
            # Keep real output and label the boundary rather than invent steps.
            steps.clear()
            notices.append('This query executes correctly, but its dependent expressions cannot be split into independent stages. Showing the complete query result instead.')
            add('Complete query · dependent expressions', query, 'query/complete')
        return {'steps': steps, 'finalResult': final, 'notices': notices,
                'ordered': bool(query.args.get('order')), 'source': 'duckdb-logical-stages'}

    finally:
        connection.close()


def run_query(sql, tables):
    """Execute each request in its own process and in-memory database."""
    validate_tables(tables)
    parse_query(sql, tables)
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), '--worker'],
            input=json.dumps({'sql': sql, 'tables': tables}), capture_output=True,
            text=True, timeout=12, check=False,
        )
        payload = json.loads(completed.stdout)
    except subprocess.TimeoutExpired as error:
        raise SqlEducationError('The query exceeded the execution time limit.') from error
    except (OSError, json.JSONDecodeError) as error:
        raise SqlEducationError('The SQL worker could not complete this query.') from error
    if completed.returncode or 'error' in payload:
        raise SqlEducationError(payload.get('error', 'SQL execution failed.'))
    return payload


if __name__ == '__main__' and '--worker' in sys.argv:
    try:
        body = json.load(sys.stdin)
        print(json.dumps(walkthrough(body['sql'], body['tables']), default=str))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
