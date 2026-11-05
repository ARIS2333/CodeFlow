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
            if column.get('type') not in {'INTEGER', 'DOUBLE', 'VARCHAR', 'BOOLEAN'}:
                raise SqlEducationError('Column types: INTEGER, DOUBLE, VARCHAR, BOOLEAN.')
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
    if len(statements) != 1 or not isinstance(statements[0], exp.Select):
        raise SqlEducationError('This version supports one read-only SELECT query.')
    query = statements[0]
    if len(list(query.find_all(exp.Select))) != 1:
        raise SqlEducationError('Subqueries and CTEs are not supported yet.')
    allowed_args = {'expressions', 'from_', 'joins', 'where', 'group', 'having', 'order', 'limit', 'distinct'}
    if any(value and key not in allowed_args for key, value in query.args.items()):
        raise SqlEducationError('This query uses a clause not supported in the walkthrough yet.')
    allowed_functions = {'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'ABS', 'ROUND', 'LOWER', 'UPPER', 'LENGTH'}
    for node in query.walk():
        if isinstance(node, (exp.Window, exp.Subquery, exp.Command)):
            raise SqlEducationError('Window functions and subqueries are not supported yet.')
        if isinstance(node, exp.Func):
            if isinstance(node, exp.Anonymous) or node.sql_name() not in allowed_functions:
                raise SqlEducationError('This version supports basic aggregates and scalar functions only.')
    known_tables = {table['name'].lower() for table in tables}
    for table in query.find_all(exp.Table):
        if table.catalog or table.db or table.name.lower() not in known_tables:
            raise SqlEducationError('Queries may only read the supplied teaching tables.')
    for join in query.args.get('joins') or []:
        if join.args.get('using') or join.args.get('method') or join.args.get('kind') in {'SEMI', 'ANTI', 'ASOF'}:
            raise SqlEducationError('Use ordinary JOIN ... ON in this version.')
    if query.args.get('limit') and not isinstance(query.args['limit'].expression, exp.Literal):
        raise SqlEducationError('LIMIT must be a non-negative integer literal.')
    if query.args.get('limit'):
        value = query.args['limit'].expression
        if value.is_string or not re.fullmatch(r'\d+', value.this):
            raise SqlEducationError('LIMIT must be a non-negative integer literal.')
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

        def add(label, stage):
            statement = stage.sql(dialect='duckdb')
            steps.append({'id': str(len(steps) + 1), 'label': label,
                          'sql': statement, 'result': result(statement)})

        stage = exp.select('*')
        if query.args.get('from_'):
            stage.set('from_', query.args['from_'].copy())
            add('FROM ' + query.args['from_'].this.sql(dialect='duckdb'), stage)
        for join in query.args.get('joins') or []:
            stage.set('joins', [*(stage.args.get('joins') or []), join.copy()])
            add(join.sql(dialect='duckdb'), stage)
        if query.args.get('where'):
            stage.set('where', query.args['where'].copy())
            add(query.args['where'].sql(dialect='duckdb'), stage)
        stage.set('expressions', [expression.copy() for expression in query.expressions])
        if query.args.get('group'):
            stage.set('group', query.args['group'].copy())
        if query.args.get('having'):
            stage.set('having', query.args['having'].copy())
        # Aggregation, HAVING and projection are one unit: aliases and grouped
        # columns cannot always be evaluated as separate valid SQL prefixes.
        label = 'SELECT ' + ', '.join(expression.sql(dialect='duckdb') for expression in query.expressions)
        if query.args.get('group'):
            label = query.args['group'].sql(dialect='duckdb') + ' · ' + label
        if query.args.get('having'):
            label += ' · ' + query.args['having'].sql(dialect='duckdb')
        add(label, stage)
        for clause in ('distinct', 'order', 'limit'):
            if query.args.get(clause):
                stage.set(clause, query.args[clause].copy())
                add('DISTINCT' if clause == 'distinct' else query.args[clause].sql(dialect='duckdb'), stage)
        return {'steps': steps, 'finalResult': final,
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
